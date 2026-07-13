// game.js — Core game loop: timer, sentence progression, swipe processing

import store from './state.js';
import wordBank from './words.js';
import { uuid } from './utils.js';

class Game {
  constructor() {
    this.timerInterval = null;
    this.rafId = null;
    this._unsubs = [];
  }

  /**
   * Initialize: subscribe to state changes and swipe events
   */
  init() {
    // Listen for screen transitions
    this._unsubs.push(
      store.on('change:screen', (screen) => {
        if (screen === 'game') this._onEnterGame();
      })
    );

    // Listen for timer duration changes
    this._unsubs.push(
      store.on('change:settings.timerDuration', (duration) => {
        store.set('game.timerDuration', duration);
      })
    );
  }

  /**
   * Called when entering the game screen
   */
  _onEnterGame() {
    const status = store.get('game.status');

    if (status === 'idle') {
      this.startNewSession();
    } else if (status === 'paused') {
      // Resume from pause (e.g., returning from review)
      this._resumeSession();
    }
  }

  /**
   * Start a brand new study session
   */
  async startNewSession() {
    store.resetGame();

    // Select session words (async — may need to load word packs)
    const count = 50;
    const sessionWords = await wordBank.getSessionWords(count);

    if (!sessionWords || sessionWords.length === 0) {
      console.error('[Game] No words available!');
      return;
    }

    store.set('game.sessionWords', sessionWords);
    store.set('game.currentIndex', 0);
    store.set('game.knownCount', 0);
    store.set('game.unknownCount', 0);
    store.set('game.history', []);
    store.set('game.status', 'playing');
    store.set('screen', 'game');

    this._showCurrentSentence();
  }

  /**
   * Resume a paused session
   */
  _resumeSession() {
    store.set('game.status', 'playing');
    this._showCurrentSentence();
  }

  /**
   * Display the current sentence with highlighted word and start timer
   */
  _showCurrentSentence() {
    const sessionWords = store.get('game.sessionWords');
    const idx = store.get('game.currentIndex');

    if (idx >= sessionWords.length) {
      this._endSession();
      return;
    }

    const word = sessionWords[idx];

    // Store current word ID for easily undoing
    store.set('game.currentWordId', word.id);

    // Update DOM
    const sentenceEl = document.getElementById('sentence-text');
    const badgeEl = document.getElementById('word-badge');
    const timerText = document.getElementById('timer-text');
    const toastEl = document.getElementById('action-toast');
    const keyHints = document.getElementById('key-hints');

    if (sentenceEl) {
      // Highlight the target word in the sentence
      const highlighted = this._highlightWord(word.exampleSentence, word.word);
      sentenceEl.innerHTML = highlighted;
    }

    if (badgeEl) {
      badgeEl.textContent = `${word.word} · ${word.partOfSpeech} · ${word.cefrLevel}`;
    }

    if (toastEl) {
      toastEl.className = 'action-toast';
      toastEl.textContent = '';
    }

    // Show keyboard hints for Mac
    if (keyHints) {
      const device = store.get('device');
      if (device === 'mac') {
        keyHints.textContent = '↑W know · ↓S unknown · ←A undo · Space/F fav';
      } else {
        keyHints.textContent = '';
      }
    }

    // Start countdown
    const duration = store.get('game.timerDuration');
    store.set('game.timerRemaining', duration);
    store.set('game.timerRunning', true);

    if (timerText) timerText.textContent = duration;

    this._updateTimerRing(duration, duration);
    this._startTimer();
  }

  /**
   * Highlight the target word in a sentence.
   * Tries exact match first, then prefix/partial match.
   */
  _highlightWord(sentence, word) {
    if (!sentence || !word) return sentence;

    // 1) Exact word boundary match
    const exact = new RegExp(`\\b(${this._escapeRegex(word)})\\b`, 'i');
    if (exact.test(sentence)) {
      return sentence.replace(exact, '<mark class="word-highlight">$1</mark>');
    }

    // 2) Word appears as prefix of a longer word (e.g. "analyze" in "analyzed")
    const prefix = new RegExp(`\\b(${this._escapeRegex(word)}[a-z]*)\\b`, 'i');
    if (prefix.test(sentence)) {
      return sentence.replace(prefix, '<mark class="word-highlight">$1</mark>');
    }

    // 3) Case-insensitive substring match (last resort)
    const sub = new RegExp(`(${this._escapeRegex(word)})`, 'i');
    if (sub.test(sentence)) {
      return sentence.replace(sub, '<mark class="word-highlight">$1</mark>');
    }

    // 4) No match — show word in a badge after the sentence
    return sentence + ` <mark class="word-highlight">${this._escapeHTML(word)}</mark>`;
  }

  _escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Start the countdown timer
   */
  _startTimer() {
    this._stopTimer();

    this.timerInterval = setInterval(() => {
      const remaining = store.get('game.timerRemaining') - 1;
      store.set('game.timerRemaining', remaining);

      const timerText = document.getElementById('timer-text');
      if (timerText) {
        timerText.textContent = remaining;
      }

      const duration = store.get('game.timerDuration');
      this._updateTimerRing(remaining, duration);

      // Color pulse at thresholds
      const ring = document.getElementById('timer-ring-fill');
      if (ring) {
        const ratio = remaining / duration;
        if (ratio <= 0.1) {
          ring.style.stroke = '#FF4444';
        } else if (ratio <= 0.25) {
          ring.style.stroke = '#FFA500';
        } else if (ratio <= 0.5) {
          ring.style.stroke = '#FFD700';
        }
      }

      if (remaining <= 0) {
        this._stopTimer();
        this._autoMarkUnknown();
      }
    }, 1000);
  }

  /**
   * Stop the timer
   */
  _stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  /**
   * Update the SVG timer ring
   */
  _updateTimerRing(remaining, total) {
    const ring = document.getElementById('timer-ring-fill');
    if (!ring) return;

    const circumference = 2 * Math.PI * 26; // r=26 from SVG
    const offset = circumference * (1 - remaining / total);
    ring.style.strokeDasharray = `${circumference}`;
    ring.style.strokeDashoffset = `${offset}`;
  }

  /**
   * Auto-mark as unknown when timer expires
   */
  _autoMarkUnknown() {
    const currentWord = this._getCurrentWord();
    if (!currentWord) return;

    this._recordAction('unknown', currentWord, true);
    this._showToast("Time's up! Marked for review", 'toast-timeout');
    this._advanceToNext();
  }

  /**
   * Process a swipe direction
   */
  processSwipe(direction) {
    const status = store.get('game.status');
    if (status !== 'playing') return;

    const currentWord = this._getCurrentWord();
    if (!currentWord) return;

    switch (direction) {
      case 'up': {
        store.set('game.knownCount', store.get('game.knownCount') + 1);
        this._recordAction('known', currentWord);
        this._showToast('✓ Got it!', 'toast-known');
        this._refreshGameHeader();
        this._advanceToNext();
        break;
      }
      case 'down': {
        store.set('game.unknownCount', store.get('game.unknownCount') + 1);
        this._recordAction('unknown', currentWord);
        this._showToast('Added to review', 'toast-unknown');
        this._refreshGameHeader();
        this._checkUnknownThreshold();
        this._advanceToNext();
        break;
      }

      case 'left':
        this._undoLastAction();
        break;

      default:
        break;
    }
  }

  /**
   * Add to favorites (triggered by double tap)
   */
  addToFavorites() {
    const status = store.get('game.status');
    if (status !== 'playing') return;

    const currentWord = this._getCurrentWord();
    if (!currentWord) return;

    const favorites = store.get('favorites') || [];
    const existing = favorites.find(f => f.word === currentWord.word && f.sentence === currentWord.exampleSentence);

    if (existing) {
      this._showToast('Already in favorites! ♥', 'toast-fav-dupe');
      return;
    }

    const fav = {
      id: uuid(),
      word: currentWord.word,
      sentence: currentWord.exampleSentence,
      definition: currentWord.definition,
      partOfSpeech: currentWord.partOfSpeech,
      phonetic: currentWord.phonetic || '',
      savedAt: new Date().toISOString(),
    };

    favorites.push(fav);
    store.set('favorites', [...favorites]);
    this._saveFavorites();

    // Trigger heart animation
    this._burstHeart();
    this._showToast('♥ Saved to favorites!', 'toast-fav');
  }

  /**
   * Trigger heart burst animation
   */
  _burstHeart() {
    const container = document.getElementById('heart-burst');
    if (!container) return;

    // Create floating hearts
    const hearts = ['♥', '❤', '♡'];
    for (let i = 0; i < 5; i++) {
      const heart = document.createElement('span');
      heart.className = 'floating-heart';
      heart.textContent = hearts[Math.floor(Math.random() * hearts.length)];
      heart.style.left = `${20 + Math.random() * 60}%`;
      heart.style.animationDelay = `${i * 0.1}s`;
      heart.style.fontSize = `${16 + Math.random() * 20}px`;
      container.appendChild(heart);

      // Remove after animation
      setTimeout(() => heart.remove(), 1200);
    }
  }

  /**
   * Save favorites to localStorage
   */
  _saveFavorites() {
    try {
      localStorage.setItem('ielts-beach-favorites', JSON.stringify(store.get('favorites')));
    } catch (e) {
      console.warn('[Game] Could not save favorites');
    }
  }

  /**
   * Record an action for undo history
   */
  _recordAction(type, word, autoMarked = false) {
    const history = store.get('game.history') || [];
    const previousProgress = store.get('wordBank.progress')?.[word.id] || null;

    history.push({
      type,
      wordId: word.id,
      word,
      wordIndex: store.get('game.currentIndex'),
      autoMarked,
      previousProgress,
      timestamp: Date.now(),
    });

    // Keep history manageable
    if (history.length > 50) {
      history.shift();
    }

    store.set('game.history', history);

    // Record to word bank
    const status = type === 'known' ? 'known' : 'unknown';
    wordBank.record(word.id, status);
  }

  /**
   * Undo the last action
   */
  _undoLastAction() {
    const history = store.get('game.history') || [];
    if (history.length === 0) {
      this._showToast('Nothing to undo', 'toast-undo-empty');
      return;
    }

    const action = history.pop();
    store.set('game.history', [...history]);

    // Revert the count
    if (action.type === 'known') {
      store.set('game.knownCount', Math.max(0, store.get('game.knownCount') - 1));
    } else if (action.type === 'unknown') {
      store.set('game.unknownCount', Math.max(0, store.get('game.unknownCount') - 1));
    }
    this._refreshGameHeader();

    // Revert word bank progress
    wordBank.revert(action.wordId, action.previousProgress);

    // Go back to the previous sentence
    store.set('game.currentIndex', action.wordIndex);
    this._showToast('↶ Undone!', 'toast-undo');
    this._showCurrentSentence();
  }

  /**
   * Advance to the next sentence
   */
  _advanceToNext() {
    this._stopTimer();

    const nextIdx = store.get('game.currentIndex') + 1;
    const sessionWords = store.get('game.sessionWords');

    if (nextIdx >= sessionWords.length) {
      // Session complete
      this._endSession();
      return;
    }

    store.set('game.currentIndex', nextIdx);
    this._refreshGameHeader();

    // Brief delay for toast visibility
    setTimeout(() => {
      this._showCurrentSentence();
    }, 300);
  }

  /**
   * Check if unknown threshold has been reached
   */
  _checkUnknownThreshold() {
    const unknownCount = store.get('game.unknownCount');
    const threshold = store.get('settings.unknownThreshold');

    if (unknownCount >= threshold) {
      this._stopTimer();
      store.set('game.status', 'paused');

      // Trigger review
      setTimeout(() => {
        this._startReview();
      }, 500);
    }
  }

  /**
   * Start review mode with collected unknown words
   */
  _startReview() {
    const history = store.get('game.history') || [];
    const sessionWords = store.get('game.sessionWords');

    // Collect unique unknown words
    const seen = new Set();
    const cards = [];

    for (const action of history) {
      if (action.type === 'unknown' && !seen.has(action.wordId)) {
        seen.add(action.wordId);
        const word = sessionWords.find(w => w.id === action.wordId) || action.word;
        cards.push({
          wordId: action.wordId,
          word: word.word,
          sentence: word.exampleSentence,
          definition: word.definition,
          partOfSpeech: word.partOfSpeech,
          phonetic: word.phonetic || '',
          isFlipped: false,
          reviewed: false,
        });
      }
    }

    store.set('review.cards', cards);
    store.set('review.currentIndex', 0);
    store.set('review.flipped', false);
    store.set('screen', 'review');
  }

  /**
   * End the current session
   */
  _endSession() {
    this._stopTimer();
    store.set('game.status', 'idle');
    store.set('screen', 'menu');

    const known = store.get('game.knownCount');
    const unknown = store.get('game.unknownCount');
    this._showToast(`Session complete! ${known} known, ${unknown} to review`, 'toast-session-end');
  }

  /**
   * Get the current word object
   */
  _getCurrentWord() {
    const sessionWords = store.get('game.sessionWords');
    const idx = store.get('game.currentIndex');
    return sessionWords[idx] || null;
  }

  /**
   * Show a toast message on the game screen
   */
  _showToast(message, type = '') {
    const toastEl = document.getElementById('action-toast');
    if (!toastEl) return;

    toastEl.textContent = message;
    toastEl.className = `action-toast ${type} visible`;

    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toastEl.className = 'action-toast';
    }, 1500);
  }

  // Direct DOM update for game header — called inline after every score change
  _refreshGameHeader() {
    const kn = document.getElementById('game-known');
    const un = document.getElementById('game-unknown');
    const bar = document.getElementById('game-progress-fill');
    const known = Number(store.get('game.knownCount')) || 0;
    const unknown = Number(store.get('game.unknownCount')) || 0;
    if (kn) kn.textContent = known;
    if (un) un.textContent = unknown;
    if (bar) {
      const words = store.get('game.sessionWords') || [];
      const idx = Number(store.get('game.currentIndex')) || 0;
      bar.style.width = words.length ? ((idx / words.length) * 100) + '%' : '0%';
    }
  }

  /**
   * Cleanup
   */
  destroy() {
    this._stopTimer();
    this._unsubs.forEach(fn => fn());
    this._unsubs = [];
  }
}

// Singleton
export const game = new Game();
export default game;
