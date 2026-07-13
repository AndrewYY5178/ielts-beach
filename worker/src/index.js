// index.js — Lightweight sync Worker (passphrase-based, ~150 lines)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Only accept POST for sync
    if (method !== 'POST') {
      return withCORS(jsonError(405, 'Method not allowed'));
    }

    try {
      const body = await request.json();
      const { sync_key } = body;

      if (!sync_key || typeof sync_key !== 'string' || sync_key.length < 64) {
        return withCORS(jsonError(400, 'Invalid sync_key'));
      }

      if (url.pathname === '/api/v1/sync/push') {
        return withCORS(await handlePush(env, sync_key, body));
      }

      if (url.pathname === '/api/v1/sync/pull') {
        return withCORS(await handlePull(env, sync_key, body));
      }

      return withCORS(jsonError(404, 'Not found'));
    } catch (e) {
      console.error('[Worker]', e);
      return withCORS(jsonError(500, 'Internal error'));
    }
  }
};

// === Sync push ===
async function handlePush(env, syncKey, body) {
  const { progress, favorites } = body;
  const now = new Date().toISOString();

  // Upsert progress entries
  if (progress && typeof progress === 'object') {
    const stmt = env.DB.prepare(`
      INSERT INTO progress (sync_key, word_id, status, timestamp)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(sync_key, word_id) DO UPDATE SET
        status = excluded.status,
        timestamp = excluded.timestamp
      WHERE excluded.timestamp > timestamp
    `);

    const batch = [];
    for (const [wordId, entry] of Object.entries(progress)) {
      batch.push(stmt.bind(syncKey, wordId, entry.status || 'unknown', entry.timestamp || now));
    }

    // Execute in batches of 25
    for (let i = 0; i < batch.length; i += 25) {
      await env.DB.batch(batch.slice(i, i + 25));
    }
  }

  // Upsert favorites
  if (favorites && Array.isArray(favorites)) {
    const stmt = env.DB.prepare(`
      INSERT INTO favorites (sync_key, fav_id, word, sentence, definition, saved_at, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(sync_key, fav_id) DO UPDATE SET
        word = excluded.word,
        sentence = excluded.sentence,
        definition = excluded.definition,
        timestamp = excluded.timestamp
      WHERE excluded.timestamp > timestamp
    `);

    const batch = [];
    for (const fav of favorites) {
      batch.push(stmt.bind(
        syncKey, fav.id || crypto.randomUUID(),
        fav.word || '', fav.sentence || '', fav.definition || '',
        fav.savedAt || now, now
      ));
    }

    for (let i = 0; i < batch.length; i += 25) {
      await env.DB.batch(batch.slice(i, i + 25));
    }
  }

  return jsonSuccess({ pushed: true });
}

// === Sync pull ===
async function handlePull(env, syncKey, body) {
  const { since } = body;
  const sinceDate = since || '1970-01-01T00:00:00Z';

  // Pull progress
  const progressRows = await env.DB.prepare(`
    SELECT word_id, status, timestamp FROM progress
    WHERE sync_key = ? AND timestamp > ?
    ORDER BY timestamp DESC
    LIMIT 5000
  `).bind(syncKey, sinceDate).all();

  const progress = {};
  for (const row of progressRows.results) {
    progress[row.word_id] = { status: row.status, timestamp: row.timestamp };
  }

  // Pull favorites
  const favRows = await env.DB.prepare(`
    SELECT fav_id, word, sentence, definition, saved_at, timestamp FROM favorites
    WHERE sync_key = ? AND timestamp > ?
    ORDER BY timestamp DESC
    LIMIT 1000
  `).bind(syncKey, sinceDate).all();

  const favorites = favRows.results.map(r => ({
    id: r.fav_id,
    word: r.word,
    sentence: r.sentence,
    definition: r.definition,
    savedAt: r.saved_at,
  }));

  return jsonSuccess({ progress, favorites });
}

// === Helpers ===
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function withCORS(response) {
  const r = new Response(response.body, response);
  Object.entries(corsHeaders()).forEach(([k, v]) => r.headers.set(k, v));
  return r;
}

function jsonSuccess(data) {
  return new Response(JSON.stringify({ success: true, ...data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ success: false, error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
