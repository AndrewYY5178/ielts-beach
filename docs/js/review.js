// review.js — Review mode with card flip

import store from './state.js';
import wordBank from './words.js';

class ReviewMode {
  constructor() {
    this._unsubs = [];
  }

  /**
   * Initialize review mode
   */
  init() {
    this._unsubs.push(
      store.on('change:screen', (screen) => {
        if (screen === 'review') this._onEnterReview();
      })
    );

    // Listen for card flip toggles from keyboard
    this._unsubs.push(
      store.on('review:toggleFlip', () => this.toggleFlip())
    );

    // Bind click on flip card
    const flipCard = document.getElementById('flip-card');
    if (flipCard) {
      flipCard.addEventListener('click', () => this.toggleFlip());
    }

    // Bind nav buttons
    const btnPrev = document.getElementById('btn-review-prev');
    const btnNext = document.getElementById('btn-review-next');
    const btnComplete = document.getElementById('btn-review-complete');
    const btnBack = document.getElementById('btn-review-back');

    if (btnPrev) btnPrev.addEventListener('click', () => this.prevCard());
    if (btnNext) btnNext.addEventListener('click', () => this.nextCard());
    if (btnComplete) btnComplete.addEventListener('click', () => this.completeReview());
    if (btnBack) btnBack.addEventListener('click', () => this.completeReview());
  }

  /**
   * Called when entering review screen
   */
  _onEnterReview() {
    const cards = store.get('review.cards') || [];
    const currentIndex = store.get('review.currentIndex');

    if (cards.length === 0) {
      // Nothing to review
      this.completeReview();
      return;
    }

    this._renderCard(currentIndex);
    this._renderProgress();
    this._renderDots();
  }

  /**
   * Render a review card
   */
  _renderCard(index) {
    const cards = store.get('review.cards') || [];
    if (!cards[index]) return;

    const card = cards[index];

    // Front
    const sentenceEl = document.getElementById('flip-sentence');
    if (sentenceEl) {
      sentenceEl.innerHTML = this._highlightWord(card.sentence, card.word);
    }

    // Back
    const wordEl = document.getElementById('flip-word');
    const phoneticEl = document.getElementById('flip-phonetic');
    const posEl = document.getElementById('flip-pos');
    const defEl = document.getElementById('flip-definition');

    if (wordEl) wordEl.textContent = card.word;
    if (phoneticEl) phoneticEl.textContent = card.phonetic || '';
    if (posEl) posEl.textContent = card.partOfSpeech || '';
    if (defEl) defEl.textContent = card.definition || '';

    // Reset flip state
    const inner = document.getElementById('flip-card-inner');
    if (inner) {
      inner.classList.remove('flipped');
      store.set('review.flipped', false);
    }
  }

  /**
   * Highlight the target word in a sentence
   */
  _highlightWord(sentence, word) {
    const regex = new RegExp(`\\b(${this._escapeRegex(word)})\\b`, 'i');
    return sentence.replace(regex,
      '<mark class="word-highlight">$1</mark>');
  }

  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Toggle card flip (front ↔ back)
   */
  toggleFlip() {
    const inner = document.getElementById('flip-card-inner');
    if (!inner) return;

    const isFlipped = inner.classList.contains('flipped');
    if (isFlipped) {
      inner.classList.remove('flipped');
      store.set('review.flipped', false);
    } else {
      inner.classList.add('flipped');
      store.set('review.flipped', true);

      // Mark as reviewed
      const cards = store.get('review.cards') || [];
      const idx = store.get('review.currentIndex');
      if (cards[idx]) {
        cards[idx].reviewed = true;
        store.set('review.cards', [...cards]);
      }
    }
  }

  /**
   * Go to previous card
   */
  prevCard() {
    const currentIndex = store.get('review.currentIndex');
    if (currentIndex > 0) {
      store.set('review.currentIndex', currentIndex - 1);
      store.set('review.flipped', false);
      this._renderCard(currentIndex - 1);
      this._renderProgress();
      this._renderDots();
    }
  }

  /**
   * Go to next card
   */
  nextCard() {
    const cards = store.get('review.cards') || [];
    const currentIndex = store.get('review.currentIndex');
    if (currentIndex < cards.length - 1) {
      store.set('review.currentIndex', currentIndex + 1);
      store.set('review.flipped', false);
      this._renderCard(currentIndex + 1);
      this._renderProgress();
      this._renderDots();
    }
  }

  /**
   * Render progress header
   */
  _renderProgress() {
    const cards = store.get('review.cards') || [];
    const idx = store.get('review.currentIndex');
    const el = document.getElementById('review-progress');
    if (el) {
      el.textContent = `${idx + 1}/${cards.length}`;
    }
  }

  /**
   * Render progress dots at bottom
   */
  _renderDots() {
    const container = document.getElementById('review-dots');
    if (!container) return;

    const cards = store.get('review.cards') || [];
    const idx = store.get('review.currentIndex');

    container.innerHTML = '';
    for (let i = 0; i < cards.length; i++) {
      const dot = document.createElement('span');
      dot.className = 'review-dot';
      if (i === idx) dot.classList.add('active');
      if (cards[i].reviewed) dot.classList.add('reviewed');
      dot.addEventListener('click', () => {
        store.set('review.currentIndex', i);
        store.set('review.flipped', false);
        this._renderCard(i);
        this._renderProgress();
        this._renderDots();
      });
      container.appendChild(dot);
    }
  }

  /**
   * Complete the review session
   */
  completeReview() {
    const cards = store.get('review.cards') || [];

    // Mark all reviewed cards in progress
    for (const card of cards) {
      if (card.reviewed) {
        wordBank.record(card.wordId, 'reviewed_known');
      }
    }

    // Clear review state
    store.set('review.cards', []);
    store.set('review.currentIndex', 0);
    store.set('review.flipped', false);

    // Reset unknown count and resume game
    store.set('game.unknownCount', 0);
    store.set('game.status', 'playing');
    store.set('screen', 'game');
  }

  /**
   * Cleanup
   */
  destroy() {
    this._unsubs.forEach(fn => fn());
  }
}

// Singleton
export const reviewMode = new ReviewMode();
export default reviewMode;
