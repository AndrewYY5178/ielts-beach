// state.js — EventEmitter-based central state store

/**
 * Simple EventEmitter for state change subscriptions
 */
class Store {
  constructor() {
    this._state = {
      // Device info
      device: 'iphone',
      online: navigator.onLine,

      // App
      screen: 'welcome',

      // Identity
      identity: null,       // { syncKey, createdAt }

      // Game
      game: {
        status: 'idle',          // 'idle' | 'playing' | 'paused' | 'review'
        sessionWords: [],        // Word objects for this session
        currentIndex: 0,
        knownCount: 0,
        unknownCount: 0,
        timerDuration: 10,
        timerRemaining: 10,
        timerRunning: false,
        timerInterval: null,
        history: [],             // Action history for undo
        gestureHintsShown: 0,    // Times gesture hints have been shown
      },

      // Review
      review: {
        cards: [],               // Unknown word cards
        currentIndex: 0,
        flipped: false,
      },

      // Favorites
      favorites: [],

      // Word bank
      wordBank: {
        words: [],
        loaded: false,
        progress: {},            // wordId → { status, timestamp }
        filters: {
          levels: ['B1', 'B2', 'C1', 'C2'],
          search: '',
        },
      },

      // Settings
      settings: {
        timerDuration: 10,
        unknownThreshold: 10,
      },

      // Stats (local, derived)
      stats: {
        dayStreak: 0,
        lastStudyDate: null,
      },

      // Sync
      sync: {
        lastSync: null,
        pending: [],
        status: 'idle',         // 'idle' | 'syncing' | 'error'
      },

      // UI
      ui: {
        toast: null,            // { message, type, timestamp }
        loading: false,
      },
    };

    this._listeners = new Map();
  }

  /**
   * Get a value by dot-notation path
   */
  get(path) {
    const keys = path.split('.');
    let value = this._state;
    for (const key of keys) {
      if (value == null) return undefined;
      value = value[key];
    }
    return value;
  }

  /**
   * Merge partial state, then emit changes
   */
  set(pathOrObj, value) {
    let changes;

    if (typeof pathOrObj === 'string') {
      // set('game.knownCount', 5)
      const keys = pathOrObj.split('.');
      let target = this._state;
      for (let i = 0; i < keys.length - 1; i++) {
        target = target[keys[i]];
      }
      const oldVal = target[keys[keys.length - 1]];
      target[keys[keys.length - 1]] = value;

      // Only emit if actually changed
      if (oldVal === value) return;

      changes = { [pathOrObj]: value };
    } else {
      // set({ game: { knownCount: 5 } })
      changes = {};
      for (const [topKey, subObj] of Object.entries(pathOrObj)) {
        for (const [subKey, val] of Object.entries(subObj)) {
          const key = `${topKey}.${subKey}`;
          const oldVal = this.get(key);
          if (oldVal !== val) {
            // Deep merge for nested objects
            if (typeof this._state[topKey] === 'object') {
              this._state[topKey][subKey] = val;
            }
            changes[key] = val;
          }
        }
      }
    }

    // Emit each changed key
    if (Object.keys(changes).length > 0) {
      this.emit('change', changes);
      for (const key of Object.keys(changes)) {
        this.emit(`change:${key}`, changes[key]);
      }
    }
  }

  /**
   * Subscribe to events
   */
  on(event, fn) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(fn);
    return () => this.off(event, fn); // Return unsubscribe function
  }

  /**
   * Unsubscribe from events
   */
  off(event, fn) {
    const set = this._listeners.get(event);
    if (set) set.delete(fn);
  }

  /**
   * Emit an event
   */
  emit(event, data) {
    const set = this._listeners.get(event);
    if (set) {
      for (const fn of set) {
        try { fn(data); } catch (e) { console.error(`[State] Error in listener for "${event}":`, e); }
      }
    }
  }

  /**
   * Reset game state for a new session
   */
  resetGame() {
    this.set({
      game: {
        ...this._state.game,
        status: 'playing',
        sessionWords: [],
        currentIndex: 0,
        knownCount: 0,
        unknownCount: 0,
        timerDuration: this._state.settings.timerDuration,
        timerRemaining: this._state.settings.timerDuration,
        timerRunning: false,
        timerInterval: null,
        history: [],
      },
      review: {
        cards: [],
        currentIndex: 0,
        flipped: false,
      }
    });
  }
}

// Singleton instance
export const store = new Store();
export default store;
