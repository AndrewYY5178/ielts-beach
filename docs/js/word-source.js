// word-source.js — WordSource abstraction with lazy loading & caching
//
// Architecture:
//   words.js ← WordSource ← Static Packs (Cloudflare Pages)
//                        ← Dictionary API (dictionaryapi.dev)
//                        ← D1 Backend (future)
//
// Packs are lazy-loaded on demand and cached in IndexedDB.

import { API_BASE, WORDS_BASE } from './config.js';

const DB_NAME = 'ielts-word-cache';
const DB_VERSION = 1;
const MANIFEST_URL = `${WORDS_BASE}/manifest.json`;

// =============================================================
//  CORE ABSTRACTION
// =============================================================

class WordSource {
  constructor() {
    this._manifest = null;       // Manifest object
    this._loadedPacks = new Set(); // Pack IDs already loaded into memory
    this._words = new Map();     // id → word (in-memory cache)
    this._db = null;             // IndexedDB instance
    this._ready = false;
    this._loading = false;
  }

  /**
   * Initialize: load manifest, open IndexedDB, preload first pack.
   */
  async init() {
    if (this._ready) return;
    if (this._loading) {
      // Wait for existing init
      let tries = 0;
      while (this._loading && tries < 100) {
        await new Promise(r => setTimeout(r, 100));
        tries++;
      }
      if (this._ready) return;
    }

    this._loading = true;
    try {
      // Open IndexedDB
      this._db = await openWordCache();

      // Load manifest
      this._manifest = await this._fetchManifest();
      console.log(`[WordSource] Manifest loaded: ${this._manifest.totalWords} words, ${this._manifest.packCount} packs`);

      // Preload first pack from cache or network
      if (this._manifest.packs.length > 0) {
        await this._loadPack(this._manifest.packs[0].id);
      }

      this._ready = true;
      console.log(`[WordSource] Ready — ${this._words.size} words in memory`);
    } catch (e) {
      console.error('[WordSource] Init failed:', e);
      throw e;
    } finally {
      this._loading = false;
    }
  }

  /**
   * Get a word by ID
   */
  get(id) {
    return this._words.get(id) || null;
  }

  /**
   * Get all currently loaded words
   */
  getAll() {
    return Array.from(this._words.values());
  }

  /**
   * How many words are currently loaded?
   */
  get loadedCount() {
    return this._words.size;
  }

  /**
   * Total words available (from manifest)
   */
  get totalCount() {
    return this._manifest?.totalWords || 0;
  }

  /**
   * Filter loaded words (for quick display).
   * For full search, use search().
   */
  filter({ levels = ['B1', 'B2', 'C1', 'C2'], search = '' } = {}) {
    let result = this.getAll();

    if (levels.length > 0 && levels.length < 6) {
      result = result.filter(w => levels.includes(w.cefrLevel));
    }

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(w =>
        w.word.toLowerCase().includes(q) ||
        w.definition.toLowerCase().includes(q)
      );
    }

    return result;
  }

  /**
   * Ensure all packs are loaded (for full search or word bank browsing)
   */
  async loadAll() {
    if (!this._manifest) return;
    const packs = this._manifest.packs;
    for (const pack of packs) {
      if (!this._loadedPacks.has(pack.id)) {
        await this._loadPack(pack.id);
      }
    }
    console.log(`[WordSource] All ${packs.length} packs loaded — ${this._words.size} words`);
  }

  /**
   * Search across ALL words (triggers lazy loading of remaining packs)
   */
  async search(query) {
    if (!query || query.length < 2) return this.getAll();

    // Load all packs for full search
    await this.loadAll();

    const q = query.toLowerCase();
    return this.getAll().filter(w =>
      w.word.toLowerCase().includes(q) ||
      w.definition.toLowerCase().includes(q) ||
      (w.synonyms || []).some(s => s.toLowerCase().includes(q))
    );
  }

  /**
   * Look up a word by word text (not ID).
   * Checks loaded words first, then tries dictionary API.
   */
  async lookup(wordText) {
    const key = wordText.toLowerCase();
    // Check loaded words
    for (const w of this._words.values()) {
      if (w.word.toLowerCase() === key) return w;
    }
    // Fallback: dictionary API
    return this._dictionaryLookup(wordText);
  }

  // =============================================================
  //  INTERNAL
  // =============================================================

  async _fetchManifest() {
    // Try network first (with cache busting for dev)
    try {
      const resp = await fetch(`${MANIFEST_URL}?v=${Date.now()}`);
      if (resp.ok) return resp.json();
    } catch (e) { /* fallback to cache */ }

    // Try IndexedDB cache
    if (this._db) {
      const cached = await idbGet(this._db, 'meta', 'manifest');
      if (cached) return cached;
    }

    throw new Error('Cannot load word manifest — offline and no cache');
  }

  async _loadPack(packId) {
    if (this._loadedPacks.has(packId)) return;

    const packMeta = this._manifest.packs.find(p => p.id === packId);
    if (!packMeta) throw new Error(`Unknown pack: ${packId}`);

    let packData;

    // Try cache first
    if (this._db) {
      packData = await idbGet(this._db, 'packs', packId);
    }

    // Fetch from network if not cached
    if (!packData) {
      const resp = await fetch(`${WORDS_BASE}/${packMeta.file}`);
      if (!resp.ok) throw new Error(`Failed to fetch pack: ${packId}`);
      packData = await resp.json();

      // Cache for next time
      if (this._db) {
        await idbPut(this._db, 'packs', { id: packId, ...packData });
      }
    }

    // Index words
    const words = packData.words || [];
    for (const w of words) {
      this._words.set(w.id, w);
    }

    this._loadedPacks.add(packId);
    console.log(`[WordSource] Loaded pack ${packId}: ${words.length} words`);
  }

  /**
   * Dictionary API fallback (dictionaryapi.dev — free, no key needed)
   */
  async _dictionaryLookup(word) {
    try {
      const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
      if (!resp.ok) return null;
      const data = await resp.json();
      if (!Array.isArray(data) || data.length === 0) return null;

      const entry = data[0];
      const meaning = entry.meanings?.[0];
      const def = meaning?.definitions?.[0];

      return {
        id: `dict-${word.toLowerCase()}`,
        word: entry.word || word,
        phonetic: entry.phonetic || (entry.phonetics?.[0]?.text) || '',
        partOfSpeech: meaning?.partOfSpeech || '',
        definition: def?.definition || '',
        cefrLevel: 'unknown',
        ieltsFrequency: 5,
        exampleSentence: def?.example || '',
        topicTags: [],
        synonyms: (def?.synonyms || []).slice(0, 5),
        antonyms: (def?.antonyms || []).slice(0, 5),
        _source: 'dictionary-api',
      };
    } catch (e) {
      console.warn(`[WordSource] Dictionary lookup failed for "${word}":`, e.message);
      return null;
    }
  }
}

// =============================================================
//  INDEXEDDB HELPERS
// =============================================================

function openWordCache() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      console.warn('[WordSource] IndexedDB not available');
      resolve(null);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('packs')) {
        db.createObjectStore('packs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => {
      console.warn('[WordSource] IndexedDB open failed:', event.target.error);
      resolve(null);
    };
  });
}

function idbGet(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

function idbPut(db, storeName, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve(null);
  });
}

// =============================================================
//  SINGLETON
// =============================================================

export const wordSource = new WordSource();
export default wordSource;
