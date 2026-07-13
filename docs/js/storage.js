// storage.js — IndexedDB wrapper with Promise-based API

const DB_NAME = 'ielts-beach';
const DB_VERSION = 1;

/**
 * Open (or create) the IndexedDB database.
 * Returns a Promise resolving to the db instance.
 */
function openDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Word bank store
      if (!db.objectStoreNames.contains('words')) {
        const wordsStore = db.createObjectStore('words', { keyPath: 'id' });
        wordsStore.createIndex('word', 'word', { unique: false });
        wordsStore.createIndex('cefrLevel', 'cefrLevel', { unique: false });
      }

      // Progress store
      if (!db.objectStoreNames.contains('progress')) {
        const progressStore = db.createObjectStore('progress', { keyPath: 'wordId' });
        progressStore.createIndex('status', 'status', { unique: false });
        progressStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Favorites store
      if (!db.objectStoreNames.contains('favorites')) {
        const favStore = db.createObjectStore('favorites', { keyPath: 'id' });
        favStore.createIndex('savedAt', 'savedAt', { unique: false });
      }

      // Settings store
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      // Sessions store
      if (!db.objectStoreNames.contains('sessions')) {
        const sessionStore = db.createObjectStore('sessions', { keyPath: 'id' });
        sessionStore.createIndex('startedAt', 'startedAt', { unique: false });
      }

      // User store
      if (!db.objectStoreNames.contains('user')) {
        db.createObjectStore('user', { keyPath: 'key' });
      }

      // Sync queue store
      if (!db.objectStoreNames.contains('syncQueue')) {
        const syncStore = db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
        syncStore.createIndex('status', 'status', { unique: false });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * Perform a transaction on a store
 */
function tx(db, storeName, mode = 'readonly') {
  const transaction = db.transaction(storeName, mode);
  const store = transaction.objectStore(storeName);
  return { transaction, store };
}

/**
 * Storage API
 */
export const storage = {
  _db: null,

  /**
   * Initialize the database
   */
  async init() {
    try {
      this._db = await openDB();
      console.log('[Storage] IndexedDB initialized');
      return true;
    } catch (e) {
      console.warn('[Storage] IndexedDB unavailable, falling back to localStorage:', e.message);
      this._db = null;
      return false;
    }
  },

  /**
   * Check if IndexedDB is available
   */
  isAvailable() {
    return this._db !== null;
  },

  // === WORDS ===

  async saveWords(words) {
    if (!this._db) return;
    const { store } = tx(this._db, 'words', 'readwrite');
    for (const word of words) {
      store.put(word);
    }
    await waitForTransaction(store.transaction);
  },

  async getAllWords() {
    if (!this._db) return [];
    const { store } = tx(this._db, 'words');
    return requestToPromise(store.getAll());
  },

  async getWord(id) {
    if (!this._db) return null;
    const { store } = tx(this._db, 'words');
    return requestToPromise(store.get(id));
  },

  // === PROGRESS ===

  async saveProgress(progressMap) {
    if (!this._db) return;
    const { store } = tx(this._db, 'progress', 'readwrite');
    for (const [wordId, data] of Object.entries(progressMap)) {
      store.put({ wordId, ...data });
    }
    await waitForTransaction(store.transaction);
  },

  async updateProgress(wordId, data) {
    if (!this._db) return;
    const { store } = tx(this._db, 'progress', 'readwrite');
    store.put({ wordId, ...data });
    await waitForTransaction(store.transaction);
  },

  async getAllProgress() {
    if (!this._db) return {};
    const { store } = tx(this._db, 'progress');
    const items = await requestToPromise(store.getAll());
    const map = {};
    for (const item of items) {
      const { wordId, ...data } = item;
      map[wordId] = data;
    }
    return map;
  },

  // === FAVORITES ===

  async saveFavorites(favorites) {
    if (!this._db) return;
    const { store } = tx(this._db, 'favorites', 'readwrite');
    // Clear and re-add
    await requestToPromise(store.clear());
    for (const fav of favorites) {
      store.add(fav);
    }
    await waitForTransaction(store.transaction);
  },

  async getAllFavorites() {
    if (!this._db) return [];
    const { store } = tx(this._db, 'favorites');
    return requestToPromise(store.getAll());
  },

  async removeFavorite(id) {
    if (!this._db) return;
    const { store } = tx(this._db, 'favorites', 'readwrite');
    store.delete(id);
    await waitForTransaction(store.transaction);
  },

  // === SETTINGS ===

  async saveSetting(key, value) {
    if (!this._db) return;
    const { store } = tx(this._db, 'settings', 'readwrite');
    store.put({ key, value });
    await waitForTransaction(store.transaction);
  },

  async getSetting(key) {
    if (!this._db) return null;
    const { store } = tx(this._db, 'settings');
    const result = await requestToPromise(store.get(key));
    return result ? result.value : null;
  },

  async getAllSettings() {
    if (!this._db) return {};
    const { store } = tx(this._db, 'settings');
    const items = await requestToPromise(store.getAll());
    const settings = {};
    for (const item of items) {
      settings[item.key] = item.value;
    }
    return settings;
  },

  // === SESSIONS ===

  async saveSession(session) {
    if (!this._db) return;
    const { store } = tx(this._db, 'sessions', 'readwrite');
    store.put(session);
    await waitForTransaction(store.transaction);
  },

  async getRecentSessions(limit = 10) {
    if (!this._db) return [];
    const { store } = tx(this._db, 'sessions');
    const all = await requestToPromise(store.getAll());
    return all
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
      .slice(0, limit);
  },

  // === USER ===

  async saveUser(user) {
    if (!this._db) return;
    const { store } = tx(this._db, 'user', 'readwrite');
    store.put({ key: 'current', ...user });
    await waitForTransaction(store.transaction);
  },

  async getUser() {
    if (!this._db) return null;
    const { store } = tx(this._db, 'user');
    return requestToPromise(store.get('current'));
  },

  async clearUser() {
    if (!this._db) return;
    const { store } = tx(this._db, 'user', 'readwrite');
    store.delete('current');
    await waitForTransaction(store.transaction);
  },

  // === SYNC QUEUE ===

  async enqueueSync(entry) {
    if (!this._db) return;
    const { store } = tx(this._db, 'syncQueue', 'readwrite');
    store.add({ ...entry, status: 'pending', createdAt: new Date().toISOString() });
    await waitForTransaction(store.transaction);
  },

  async getPendingSync() {
    if (!this._db) return [];
    const { store } = tx(this._db, 'syncQueue');
    const all = await requestToPromise(store.getAll());
    return all.filter(e => e.status === 'pending');
  },

  async clearSyncQueue(ids) {
    if (!this._db) return;
    const { store } = tx(this._db, 'syncQueue', 'readwrite');
    for (const id of ids) {
      store.delete(id);
    }
    await waitForTransaction(store.transaction);
  },
};

/**
 * Convert an IDBRequest to a Promise
 */
function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Wait for a transaction to complete
 */
function waitForTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(new Error('Transaction aborted'));
  });
}

/**
 * Fallback localStorage wrapper (used when IndexedDB is unavailable)
 */
export const localStorageFallback = {
  get(key) {
    try {
      const raw = localStorage.getItem(`ielts-beach-${key}`);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },

  set(key, value) {
    try {
      localStorage.setItem(`ielts-beach-${key}`, JSON.stringify(value));
    } catch { /* quota exceeded */ }
  },

  remove(key) {
    localStorage.removeItem(`ielts-beach-${key}`);
  },
};

export default storage;
