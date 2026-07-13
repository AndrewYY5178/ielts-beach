// _worker.js — Cloudflare Pages Advanced Mode
// Same-domain API + static assets (no workers.dev needed)
// Requests to /api/* → handlers   |   Everything else → static files

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    // === API ROUTES ===
    if (path.startsWith('/api/v1/')) {
      try {
        // Rate limit
        if (await checkRateLimit(request, env)) {
          return corsResponse(jsonError(429, 'RATE_LIMITED', 'Too many requests'));
        }

        // Auth routes (public)
        if (path === '/api/v1/auth/register' && method === 'POST') {
          return corsResponse(await register(request, env));
        }
        if (path === '/api/v1/auth/login' && method === 'POST') {
          return corsResponse(await login(request, env));
        }
        if (path === '/api/v1/auth/verify' && method === 'POST') {
          return corsResponse(await verify(request, env));
        }

        // Authenticated routes
        const user = await authenticate(request, env);
        if (!user) {
          return corsResponse(jsonError(401, 'AUTH_FAILED', 'Authentication required'));
        }

        if (path === '/api/v1/words' && method === 'GET') {
          return corsResponse(await getWords(request, env));
        }
        if (path.startsWith('/api/v1/words/') && method === 'GET') {
          return corsResponse(await getWord(request, env));
        }
        if (path === '/api/v1/sync/push' && method === 'POST') {
          return corsResponse(await syncPush(request, env, user.id));
        }
        if (path === '/api/v1/sync/pull' && method === 'POST') {
          return corsResponse(await syncPull(request, env, user.id));
        }
        if (path === '/api/v1/stats' && method === 'GET') {
          return corsResponse(await getStats(request, env, user.id));
        }
        if (path === '/api/v1/settings' && method === 'GET') {
          return corsResponse(await getSettings(request, env, user.id));
        }
        if (path === '/api/v1/settings' && method === 'PUT') {
          return corsResponse(await updateSettings(request, env, user.id));
        }
        if (path === '/api/v1/favorites' && method === 'GET') {
          return corsResponse(await listFavorites(request, env, user.id));
        }
        if (path === '/api/v1/favorites' && method === 'POST') {
          return corsResponse(await addFavorite(request, env, user.id));
        }
        if (path.startsWith('/api/v1/favorites/') && method === 'DELETE') {
          return corsResponse(await removeFavorite(request, env, user.id));
        }

        return corsResponse(jsonError(404, 'NOT_FOUND', 'API endpoint not found'));
      } catch (e) {
        console.error('[API] Error:', e);
        return corsResponse(jsonError(500, 'INTERNAL_ERROR', 'An unexpected error occurred'));
      }
    }

    // === STATIC ASSETS (everything else) ===
    try {
      return env.ASSETS.fetch(request);
    } catch (e) {
      return new Response('Not Found', { status: 404 });
    }
  }
};

// =============================================================
//  CORS
// =============================================================

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function corsResponse(response) {
  const newResponse = new Response(response.body, response);
  for (const [key, value] of Object.entries(corsHeaders())) {
    newResponse.headers.set(key, value);
  }
  return newResponse;
}

// =============================================================
//  RATE LIMITING
// =============================================================

async function checkRateLimit(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = `rate:${ip}`;
  if (env.CACHE) {
    const current = await env.CACHE.get(key);
    const count = current ? parseInt(current) + 1 : 1;
    if (count > 100) return true;
    await env.CACHE.put(key, count.toString(), { expirationTtl: 60 });
  }
  return false;
}

// =============================================================
//  DB HELPERS
// =============================================================

async function query(db, sql, params = []) {
  const { results } = await db.prepare(sql).bind(...params).all();
  return results;
}

async function queryOne(db, sql, params = []) {
  const results = await query(db, sql, params);
  return results[0] || null;
}

async function execute(db, sql, params = []) {
  await db.prepare(sql).bind(...params).run();
}

// =============================================================
//  AUTH HANDLERS
// =============================================================

async function findUserByUsername(db, username) {
  return queryOne(db, 'SELECT id, username, pin_hash, created_at, last_login FROM users WHERE username = ?', [username]);
}

async function findUserByToken(db, token) {
  return queryOne(db, `
    SELECT u.id, u.username, u.created_at
    FROM users u JOIN auth_tokens t ON u.id = t.user_id
    WHERE t.token = ? AND t.expires_at > datetime('now')
  `, [token]);
}

async function createAuthToken(db, userId) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await execute(db, 'INSERT INTO auth_tokens (user_id, token, expires_at) VALUES (?, ?, ?)', [userId, token, expiresAt]);
  return token;
}

async function hashPin(pin, salt = 'ielts-beach-salt') {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + salt);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function register(request, env) {
  const { username, pin } = await request.json();
  if (!username || username.length < 3 || username.length > 20) {
    return jsonError(400, 'VALIDATION_ERROR', 'Username must be 3-20 characters');
  }
  if (!pin || pin.length < 6) {
    return jsonError(400, 'VALIDATION_ERROR', 'Password must be at least 6 characters');
  }
  const db = env.DB;
  const existing = await findUserByUsername(db, username);
  if (existing) return jsonError(409, 'USERNAME_TAKEN', 'Username already exists');
  const pinHash = await hashPin(pin);
  await execute(db, 'INSERT INTO users (username, pin_hash) VALUES (?, ?)', [username, pinHash]);
  const user = await findUserByUsername(db, username);
  const token = await createAuthToken(db, user.id);
  return jsonSuccess({ token, user: { id: user.id, username: user.username, createdAt: user.created_at } });
}

async function login(request, env) {
  const { username, pin } = await request.json();
  if (!username || !pin) return jsonError(400, 'VALIDATION_ERROR', 'Username and password required');
  const db = env.DB;
  const user = await findUserByUsername(db, username);
  if (!user) return jsonError(401, 'AUTH_FAILED', 'Invalid credentials');
  const pinHash = await hashPin(pin);
  if (pinHash !== user.pin_hash) return jsonError(401, 'AUTH_FAILED', 'Invalid credentials');
  await execute(db, 'UPDATE users SET last_login = datetime("now") WHERE id = ?', [user.id]);
  const token = await createAuthToken(db, user.id);
  return jsonSuccess({ token, user: { id: user.id, username: user.username } });
}

async function verify(request, env) {
  const { token } = await request.json();
  if (!token) return jsonError(400, 'VALIDATION_ERROR', 'Token required');
  const user = await findUserByToken(env.DB, token);
  return jsonSuccess({ valid: !!user, user: user || null });
}

async function authenticate(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return findUserByToken(env.DB, auth.slice(7));
}

// =============================================================
//  WORDS
// =============================================================

async function getWords(request, env) {
  const url = new URL(request.url);
  const levels = url.searchParams.get('levels')?.split(',') || [];
  const search = url.searchParams.get('search') || '';
  const limit = Math.min(parseInt(url.searchParams.get('limit')) || 50, 200);
  const offset = parseInt(url.searchParams.get('offset')) || 0;
  let sql = 'SELECT * FROM words WHERE 1=1';
  const params = [];
  if (levels.length > 0 && levels.length < 6) {
    sql += ` AND cefr_level IN (${levels.map(() => '?').join(',')})`;
    params.push(...levels);
  }
  if (search) {
    sql += ' AND (word LIKE ? OR definition LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  const countRow = await queryOne(env.DB, sql.replace('SELECT *', 'SELECT COUNT(*) as total'), params);
  sql += ' ORDER BY ielts_frequency DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const words = await query(env.DB, sql, params);
  return jsonSuccess({ words, total: countRow?.total || 0, offset, limit });
}

async function getWord(request, env) {
  const id = new URL(request.url).pathname.split('/').pop();
  const word = await queryOne(env.DB, 'SELECT * FROM words WHERE id = ?', [id]);
  if (!word) return jsonError(404, 'NOT_FOUND', 'Word not found');
  return jsonSuccess({ word });
}

// =============================================================
//  SYNC
// =============================================================

async function syncPush(request, env, userId) {
  const { entries } = await request.json();
  if (!Array.isArray(entries)) return jsonError(400, 'VALIDATION_ERROR', 'entries must be an array');
  let accepted = 0, conflicts = 0;
  for (const entry of entries) {
    const { word_id, status, timestamp } = entry;
    if (!word_id || !status) continue;
    try {
      await execute(env.DB, `
        INSERT INTO user_progress (user_id, word_id, status, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, word_id) DO UPDATE SET
          status = excluded.status, updated_at = excluded.updated_at
        WHERE excluded.updated_at > user_progress.updated_at
      `, [userId, word_id, status, timestamp || new Date().toISOString()]);
      accepted++;
    } catch (e) { conflicts++; }
  }
  return jsonSuccess({ accepted, conflicts, server_time: new Date().toISOString() });
}

async function syncPull(request, env, userId) {
  const { since } = await request.json();
  const sinceDate = since || '1970-01-01T00:00:00Z';
  const entries = await query(env.DB, `
    SELECT word_id, status, updated_at, session_id
    FROM user_progress WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `, [userId, sinceDate]);
  return jsonSuccess({ entries, server_time: new Date().toISOString() });
}

// =============================================================
//  STATS
// =============================================================

async function getStats(request, env, userId) {
  const total = await queryOne(env.DB, `
    SELECT
      COUNT(CASE WHEN status IN ('known','reviewed_known') THEN 1 END) as total_known,
      COUNT(CASE WHEN status IN ('unknown','reviewed_unknown') THEN 1 END) as total_unknown
    FROM user_progress WHERE user_id = ?
  `, [userId]);

  const sessions = await query(env.DB, `
    SELECT DISTINCT date(started_at) as session_date
    FROM game_sessions WHERE user_id = ?
    ORDER BY session_date DESC LIMIT 365
  `, [userId]);

  let currentStreak = 0, longestStreak = 0, tempStreak = 0, prevDate = null;
  if (sessions.length > 0) {
    let checkDate = new Date().toISOString().split('T')[0];
    for (const row of sessions) {
      const rowDate = row.session_date;
      if (!prevDate) {
        const diff = Math.floor((new Date(checkDate) - new Date(rowDate)) / 86400000);
        if (diff <= 1) { currentStreak = 1; checkDate = rowDate; }
        tempStreak = 1;
      } else {
        const diff = Math.floor((new Date(prevDate) - new Date(rowDate)) / 86400000);
        tempStreak = diff === 1 ? tempStreak + 1 : 1;
      }
      const diffCheck = Math.floor((new Date(checkDate) - new Date(rowDate)) / 86400000);
      if (diffCheck === 1) { currentStreak++; checkDate = rowDate; }
      else if (diffCheck > 1 && prevDate) checkDate = null;
      if (tempStreak > longestStreak) longestStreak = tempStreak;
      prevDate = rowDate;
    }
    if (tempStreak > longestStreak) longestStreak = tempStreak;
  }

  return jsonSuccess({
    total_known: total?.total_known || 0,
    total_unknown: total?.total_unknown || 0,
    current_streak: currentStreak,
    longest_streak: longestStreak,
  });
}

// =============================================================
//  SETTINGS
// =============================================================

async function getSettings(request, env, userId) {
  const s = await queryOne(env.DB, 'SELECT * FROM user_settings WHERE user_id = ?', [userId]);
  return jsonSuccess(s || { timer_duration: 10, unknown_threshold: 10, sound_enabled: true, theme: 'day' });
}

async function updateSettings(request, env, userId) {
  const body = await request.json();
  await execute(env.DB, `
    INSERT INTO user_settings (user_id, timer_duration, unknown_threshold, sound_enabled, theme, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      timer_duration = excluded.timer_duration, unknown_threshold = excluded.unknown_threshold,
      sound_enabled = excluded.sound_enabled, theme = excluded.theme, updated_at = datetime('now')
  `, [userId, body.timer_duration ?? 10, body.unknown_threshold ?? 10, body.sound_enabled ? 1 : 0, body.theme || 'day']);
  return jsonSuccess({ updated: true });
}

// =============================================================
//  FAVORITES
// =============================================================

async function listFavorites(request, env, userId) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit')) || 100, 500);
  const offset = parseInt(url.searchParams.get('offset')) || 0;
  const rows = await query(env.DB, `
    SELECT f.id, f.word_id, f.sentence, f.saved_at,
           w.word, w.phonetic, w.part_of_speech, w.definition, w.cefr_level
    FROM user_favorites f LEFT JOIN words w ON f.word_id = w.id
    WHERE f.user_id = ? AND f.deleted = 0
    ORDER BY f.saved_at DESC LIMIT ? OFFSET ?
  `, [userId, limit, offset]);
  return jsonSuccess({
    favorites: rows.map(r => ({
      id: r.id, wordId: r.word_id, word: r.word, phonetic: r.phonetic,
      partOfSpeech: r.part_of_speech, definition: r.definition,
      sentence: r.sentence, savedAt: r.saved_at,
    })),
    total: rows.length, offset, limit
  });
}

async function addFavorite(request, env, userId) {
  const { wordId, sentence } = await request.json();
  if (!wordId || !sentence) return jsonError(400, 'VALIDATION_ERROR', 'wordId and sentence required');
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const id = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  await execute(env.DB, 'INSERT INTO user_favorites (id, user_id, word_id, sentence) VALUES (?, ?, ?, ?)', [id, userId, wordId, sentence]);
  const rows = await query(env.DB, `
    SELECT f.id, f.word_id, f.sentence, f.saved_at, w.word, w.phonetic, w.part_of_speech, w.definition
    FROM user_favorites f LEFT JOIN words w ON f.word_id = w.id WHERE f.id = ?
  `, [id]);
  const fav = rows[0];
  return jsonSuccess({ id: fav.id, wordId: fav.word_id, word: fav.word, phonetic: fav.phonetic,
    partOfSpeech: fav.part_of_speech, definition: fav.definition, sentence: fav.sentence, savedAt: fav.saved_at });
}

async function removeFavorite(request, env, userId) {
  const favId = request.url.split('/').pop();
  await execute(env.DB, 'UPDATE user_favorites SET deleted = 1 WHERE id = ? AND user_id = ?', [favId, userId]);
  return jsonSuccess({ removed: true });
}

// =============================================================
//  JSON HELPERS
// =============================================================

function jsonSuccess(data) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
}

function jsonError(status, code, message) {
  return new Response(JSON.stringify({ success: false, error: { code, message } }), {
    status, headers: { 'Content-Type': 'application/json' }
  });
}
