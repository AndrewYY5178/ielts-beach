// sync.js — Lightweight cloud sync (progress + favorites)

import store from './state.js';
import { API_BASE } from './config.js';

class SyncManager {
  constructor() {
    this.syncIntervalMs = 60000;
    this.autoSyncTimer = null;
  }

  init() {
    store.on('change:online', (online) => {
      if (online) this.push();
    });

    // Auto-sync when identity is available
    if (store.get('identity')) {
      this.startAutoSync();
    }
    store.on('change:identity', (identity) => {
      if (identity) this.startAutoSync();
      else this.stopAutoSync();
    });

    console.log('[Sync] Initialized');
  }

  /**
   * Push local progress + favorites to server
   */
  async push() {
    const identity = store.get('identity');
    if (!identity?.syncKey) return;
    if (!navigator.onLine) return;

    store.set('sync.status', 'syncing');
    this._updateSyncDot('syncing');

    try {
      const progress = store.get('wordBank.progress') || {};
      const favorites = store.get('favorites') || [];

      const resp = await fetch(`${API_BASE}/sync/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sync_key: identity.syncKey,
          progress,
          favorites: favorites.map(f => ({
            id: f.id,
            word: f.word,
            sentence: f.sentence,
            definition: f.definition,
            savedAt: f.savedAt,
          })),
        }),
      });

      if (resp.ok) {
        store.set('sync.lastSync', new Date().toISOString());
        store.set('sync.status', 'idle');
        this._updateSyncDot('synced');
      }
    } catch (e) {
      console.warn('[Sync] Push failed:', e.message);
      store.set('sync.status', 'error');
      this._updateSyncDot('offline');
    }
  }

  /**
   * Pull remote progress + favorites
   */
  async pull() {
    const identity = store.get('identity');
    if (!identity?.syncKey) return;
    if (!navigator.onLine) return;

    store.set('sync.status', 'syncing');
    this._updateSyncDot('syncing');

    try {
      const lastSync = store.get('sync.lastSync') || '1970-01-01T00:00:00Z';

      const resp = await fetch(`${API_BASE}/sync/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sync_key: identity.syncKey,
          since: lastSync,
        }),
      });

      if (resp.ok) {
        const data = await resp.json();

        // Merge progress (last-writer-wins)
        if (data.progress) {
          const local = store.get('wordBank.progress') || {};
          for (const [wordId, entry] of Object.entries(data.progress)) {
            const existing = local[wordId];
            if (!existing || new Date(entry.timestamp) > new Date(existing.timestamp)) {
              local[wordId] = entry;
            }
          }
          store.set('wordBank.progress', local);
        }

        // Merge favorites
        if (data.favorites) {
          const local = store.get('favorites') || [];
          const localIds = new Set(local.map(f => f.id));
          for (const fav of data.favorites) {
            if (!localIds.has(fav.id)) {
              local.push(fav);
              localIds.add(fav.id);
            }
          }
          store.set('favorites', local);
          localStorage.setItem('ielts-beach-favorites', JSON.stringify(local));
        }

        store.set('sync.lastSync', new Date().toISOString());
        store.set('sync.status', 'idle');
        this._updateSyncDot('synced');
      }
    } catch (e) {
      console.warn('[Sync] Pull failed:', e.message);
      store.set('sync.status', 'error');
      this._updateSyncDot('offline');
    }
  }

  startAutoSync() {
    if (this.autoSyncTimer) return;
    this.pull().then(() => this.push());
    this.autoSyncTimer = setInterval(() => {
      if (navigator.onLine) this.pull().then(() => this.push());
    }, this.syncIntervalMs);
  }

  stopAutoSync() {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
  }

  _updateSyncDot(state) {
    const dot = document.getElementById('nav-sync-dot');
    if (dot) {
      dot.className = 'nav-sync-dot';
      if (state === 'synced') dot.classList.add('synced');
      if (state === 'syncing') dot.classList.add('syncing');
    }
  }

  destroy() {
    this.stopAutoSync();
  }
}

export const syncManager = new SyncManager();
export default syncManager;
