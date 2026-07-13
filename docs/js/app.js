// app.js — Application bootstrap

import store from './state.js';
import { detectDevice } from './utils.js';
import { screenManager } from './screens.js';
import { SwipeDetector } from './swipe.js';
import { game } from './game.js';
import { reviewMode } from './review.js';
import { favoritesManager } from './favorites.js';
import wordBank from './words.js';
import { authManager } from './auth.js';
import { syncManager } from './sync.js';

class App {
  constructor() {
    this.swipeDetector = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    try {
      // 1. Detect device
      const device = detectDevice();
      store.set('device', device);
      document.body.setAttribute('data-device', device);

      // 2. Load settings & identity
      this._loadSettings();
      this._loadIdentity();

      // 3. Init modules
      screenManager.init();
      game.init();
      reviewMode.init();
      favoritesManager.init();
      syncManager.init();

      // 4. Route to correct screen
      if (authManager.isSetup()) {
        store.set('screen', 'menu');
      } else {
        store.set('screen', 'welcome');
      }

      // 5. Hide loading
      this._hideLoading();

      // 6. Bind events
      this._bindUIEvents();
      this._setupSwipeDetector();
      this._setupNetworkListeners();
      this._setupSessionPersistence();
      this._loadSavedFavorites();
      this._restoreSession();
      store.on('screen:enter:menu', () => {
        this._checkPendingResume();
        this._updateMenuStats();
      });
      this._registerSW();

      // 7. Background: load word bank
      wordBank.init().then(() => {
        console.log('[App] Word bank ready');
      }).catch(err => {
        console.warn('[App] Word bank load failed:', err.message);
      });

      // 8. Background: pull sync
      syncManager.pull().catch(() => {});

      this.initialized = true;
      console.log('[App] Initialized');
    } catch (err) {
      console.error('[App] Init error:', err);
      this._hideLoading();
    }
  }

  _hideLoading() {
    const loader = document.getElementById('app-loading');
    if (loader) {
      loader.classList.add('hidden');
      setTimeout(() => loader.remove(), 600);
    }
  }

  _setupSwipeDetector() {
    const cardArea = document.getElementById('game-card-area');
    if (!cardArea) return;

    this.swipeDetector = new SwipeDetector(cardArea);
    this.swipeDetector.onSwipe = (direction) => {
      const screen = store.get('screen');
      if (screen === 'game') {
        game.processSwipe(direction);
      } else if (screen === 'review') {
        if (direction === 'left') reviewMode.nextCard();
        else if (direction === 'right') reviewMode.prevCard();
        else if (direction === 'down') reviewMode.completeReview();
      }
    };

    this.swipeDetector.onDoubleTap = () => {
      if (store.get('screen') === 'game') {
        game.addToFavorites();
      }
    };

    const reviewCard = document.getElementById('review-card-container');
    if (reviewCard) {
      const reviewSwipe = new SwipeDetector(reviewCard);
      reviewSwipe.onSwipe = (direction) => {
        if (direction === 'left') reviewMode.nextCard();
        else if (direction === 'right') reviewMode.prevCard();
        else if (direction === 'down') reviewMode.completeReview();
      };
    }
  }

  _bindUIEvents() {
    // Welcome
    this._bind('#welcome-submit', 'click', (e) => { e.preventDefault(); this._handleWelcome(); });
    this._bind('#welcome-passphrase', 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this._handleWelcome(); } });

    // Menu
    this._bind('#btn-start', 'click', () => game.startNewSession());
    this._bind('#btn-favorites-nav', 'click', () => store.set('screen', 'favorites'));
    this._bind('#btn-wordbank-nav', 'click', () => store.set('screen', 'wordbank'));
    this._bind('#btn-settings-nav', 'click', () => store.set('screen', 'settings'));

    // Game
    this._bind('#btn-game-back', 'click', () => {
      game._stopTimer();
      store.set('game.status', 'idle');
      store.set('screen', 'menu');
    });

    // Favorites
    this._bind('#btn-fav-back', 'click', () => store.set('screen', 'menu'));

    // Word bank
    this._bind('#btn-wb-back', 'click', () => store.set('screen', 'menu'));
    this._bind('#wb-search-input', 'input', (e) => this._handleWordBankSearch(e));

    // Settings
    this._bind('#btn-settings-back', 'click', () => store.set('screen', 'menu'));
    this._bind('#setting-timer', 'input', (e) => this._updateSetting('timerDuration', parseInt(e.target.value)));
    this._bind('#setting-threshold', 'input', (e) => this._updateSetting('unknownThreshold', parseInt(e.target.value)));
    this._bind('#btn-sync-now', 'click', () => this._syncNow());
    this._bind('#btn-logout', 'click', () => this._resetAll());

    // Word bank filter chips
    document.querySelectorAll('.wb-filters .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('active');
        this._handleWordBankFilter();
      });
    });

    // Nav pill items
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const screen = item.dataset.screen;
        if (screen) store.set('screen', screen);
      });
    });

    this._updateSettingsDisplay();
  }

  _bind(selector, event, handler) {
    const el = document.querySelector(selector);
    if (el) el.addEventListener(event, handler);
  }

  // === Welcome ===
  async _handleWelcome() {
    const passphrase = document.getElementById('welcome-passphrase').value.trim();
    const statusEl = document.getElementById('welcome-status');

    const result = await authManager.setPassphrase(passphrase);
    if (result.success) {
      if (statusEl) statusEl.textContent = '';
      store.set('screen', 'menu');
    } else {
      if (statusEl) statusEl.textContent = result.error || 'Please try again';
    }
  }

  // === Settings ===
  _loadSettings() {
    try {
      const raw = localStorage.getItem('ielts-beach-settings');
      if (raw) store.set('settings', JSON.parse(raw));
    } catch (_) {}
  }

  _loadIdentity() {
    const identity = authManager.getIdentity();
    if (identity) store.set('identity', identity);
  }

  _updateSetting(key, value) {
    const settings = store.get('settings');
    settings[key] = value;
    store.set('settings', { ...settings });
    localStorage.setItem('ielts-beach-settings', JSON.stringify(settings));
    this._updateSettingsDisplay();
  }

  async _updateMenuStats() {
    const progress = store.get('wordBank.progress') || {};
    let known = 0, unknown = 0;
    for (const p of Object.values(progress)) {
      if (p.status === 'known' || p.status === 'reviewed_known') known++;
      if (p.status === 'unknown' || p.status === 'reviewed_unknown') unknown++;
    }

    const knownEl = document.getElementById('stat-known');
    const unknownEl = document.getElementById('stat-unknown');
    if (knownEl) knownEl.textContent = known;
    if (unknownEl) unknownEl.textContent = unknown;

    // Streak from localStorage
    const streak = store.get('stats.dayStreak') || 0;
    const streakEl = document.getElementById('stat-streak');
    if (streakEl) streakEl.textContent = streak;

    // Update greeting
    const greetingEl = document.getElementById('menu-greeting');
    if (greetingEl) {
      const hour = new Date().getHours();
      const g = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
      greetingEl.textContent = g;
    }
  }

  _updateSettingsDisplay() {
    const settings = store.get('settings');
    const timerSlider = document.getElementById('setting-timer');
    const thresholdSlider = document.getElementById('setting-threshold');
    const timerVal = document.getElementById('setting-timer-val');
    const thresholdVal = document.getElementById('setting-threshold-val');
    const syncTimeEl = document.getElementById('setting-sync-time');

    if (timerSlider) timerSlider.value = settings.timerDuration;
    if (thresholdSlider) thresholdSlider.value = settings.unknownThreshold;
    if (timerVal) timerVal.textContent = `${settings.timerDuration}s`;
    if (thresholdVal) thresholdVal.textContent = settings.unknownThreshold;
    if (syncTimeEl) {
      const lastSync = store.get('sync.lastSync');
      syncTimeEl.textContent = lastSync ? `Last sync: ${new Date(lastSync).toLocaleString()}` : 'Not synced yet';
    }
  }

  async _syncNow() {
    store.set('sync.status', 'syncing');
    const syncTimeEl = document.getElementById('setting-sync-time');
    if (syncTimeEl) syncTimeEl.textContent = 'Syncing...';

    try {
      await syncManager.pull();
      await syncManager.push();
    } catch (e) {
      console.warn('[App] Sync failed:', e.message);
    }

    store.set('sync.lastSync', new Date().toISOString());
    store.set('sync.status', 'idle');
    if (syncTimeEl) syncTimeEl.textContent = `Last sync: ${new Date().toLocaleString()}`;
  }

  _handleWordBankSearch(e) {
    store.set('wordBank.filters', { ...store.get('wordBank.filters'), search: e.target.value });
    this._renderWordBankList();
  }

  _handleWordBankFilter() {
    const activeChips = document.querySelectorAll('.wb-filters .chip.active');
    const levels = Array.from(activeChips).map(c => c.dataset.level);
    store.set('wordBank.filters', { ...store.get('wordBank.filters'), levels });
    this._renderWordBankList();
  }

  _renderWordBankList() {
    const filters = store.get('wordBank.filters');
    const words = wordBank.filter(filters);
    const listEl = document.getElementById('wb-list');
    if (!listEl) return;

    if (words.length === 0) {
      listEl.innerHTML = '<p class="wb-empty">No words found</p>';
      return;
    }

    listEl.innerHTML = words.slice(0, 100).map(w => `
      <div class="wb-item" data-id="${w.id}">
        <div class="wb-item-main">
          <span class="wb-word">${w.word}</span>
          <span class="wb-level chip chip-sm">${w.cefrLevel}</span>
        </div>
        <p class="wb-definition">${w.definition}</p>
      </div>
    `).join('');

    if (words.length > 100) {
      listEl.innerHTML += `<p class="wb-more">... and ${words.length - 100} more</p>`;
    }
  }

  _loadSavedFavorites() {
    try {
      const raw = localStorage.getItem('ielts-beach-favorites');
      if (raw) store.set('favorites', JSON.parse(raw));
    } catch (_) {}
  }

  _setupSessionPersistence() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._saveSessionState();
    });
    window.addEventListener('beforeunload', () => this._saveSessionState());
    setInterval(() => {
      if (store.get('screen') === 'game' && store.get('game.status') === 'playing') {
        this._saveSessionState();
      }
    }, 5000);
  }

  _saveSessionState() {
    if (store.get('screen') !== 'game') return;
    const state = {
      screen: 'game',
      game: {
        sessionWords: store.get('game.sessionWords'),
        currentIndex: store.get('game.currentIndex'),
        knownCount: store.get('game.knownCount'),
        unknownCount: store.get('game.unknownCount'),
        history: store.get('game.history'),
        status: store.get('game.status'),
      },
      savedAt: Date.now(),
    };
    try { sessionStorage.setItem('ielts-beach-session', JSON.stringify(state)); } catch (_) {}
  }

  _restoreSession() {
    try {
      const raw = sessionStorage.getItem('ielts-beach-session');
      if (!raw) return;
      const state = JSON.parse(raw);
      if (Date.now() - state.savedAt > 2 * 60 * 60 * 1000) {
        sessionStorage.removeItem('ielts-beach-session');
        return;
      }
      if (state.screen === 'game' && state.game) {
        store.set('game', { ...store.get('game'), ...state.game });
        store.set('_pendingResume', true);
      }
    } catch (_) {
      sessionStorage.removeItem('ielts-beach-session');
    }
  }

  _checkPendingResume() {
    const pending = store.get('_pendingResume');
    const btnStart = document.getElementById('btn-start');
    if (!btnStart) return;

    if (pending) {
      btnStart.textContent = 'Resume Session';
      btnStart.addEventListener('click', () => {
        store.set('_pendingResume', false);
        store.set('game.status', 'playing');
        store.set('screen', 'game');
      }, { once: true });
    } else {
      btnStart.textContent = 'Start Studying';
    }
  }

  _setupNetworkListeners() {
    const updateOnline = () => {
      store.set('online', navigator.onLine);
      document.body.classList.toggle('offline', !navigator.onLine);
    };
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
  }

  _registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('[App] SW registered:', reg.scope))
      .catch(err => console.warn('[App] SW registration failed:', err));
  }

  _resetAll() {
    localStorage.removeItem('ielts-beach-identity');
    localStorage.removeItem('ielts-beach-settings');
    localStorage.removeItem('ielts-beach-favorites');
    store.set('identity', null);
    store.set('screen', 'welcome');
  }
}

const app = new App();

setTimeout(() => {
  const loader = document.getElementById('app-loading');
  if (loader && !loader.classList.contains('hidden')) {
    loader.querySelector('.loading-text').textContent = 'Something went wrong';
    loader.querySelector('.loading-sub').textContent = 'Check console (F12) for errors.';
    loader.style.background = '#39393A';
  }
}, 10000);

app.init().catch(err => {
  console.error('[App] Crash:', err);
  const loader = document.getElementById('app-loading');
  if (loader) {
    loader.querySelector('.loading-text').textContent = 'App Crashed';
    loader.querySelector('.loading-sub').textContent = err.message;
  }
});

export default app;
