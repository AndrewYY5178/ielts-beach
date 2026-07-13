// swipe.js — Gesture detection (touch, mouse, keyboard, trackpad)

import store from './state.js';
import { getSwipeThreshold, detectDevice } from './utils.js';

/**
 * SwipeDetector handles all input methods and normalizes them
 * into direction events: 'up', 'down', 'left', 'doubletap'
 */
export class SwipeDetector {
  constructor(element) {
    this.el = element;
    this.device = store.get('device');

    // Touch state
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchStartTime = 0;
    this.touching = false;

    // Mouse drag state
    this.mouseDown = false;
    this.mouseStartX = 0;
    this.mouseStartY = 0;

    // Double tap tracking
    this.lastTapTime = 0;
    this.lastTapX = 0;
    this.lastTapY = 0;
    this.doubleTapTimeout = null;

    // Debounce
    this.processing = false;
    this.debounceMs = 350;

    // Callbacks
    this.onSwipe = null;    // (direction) => {}
    this.onDoubleTap = null; // () => {}

    // Threshold varies by device
    this.threshold = getSwipeThreshold(this.device);

    this._bindEvents();
  }

  _bindEvents() {
    // Touch events (iPhone, iPad)
    this.el.addEventListener('touchstart', this._onTouchStart.bind(this), { passive: false });
    this.el.addEventListener('touchmove', this._onTouchMove.bind(this), { passive: false });
    this.el.addEventListener('touchend', this._onTouchEnd.bind(this), { passive: false });

    // Mouse events (Mac)
    this.el.addEventListener('mousedown', this._onMouseDown.bind(this));
    window.addEventListener('mousemove', this._onMouseMove.bind(this));
    window.addEventListener('mouseup', this._onMouseUp.bind(this));

    // Keyboard events (Mac) — global
    this._keyHandler = this._onKeyDown.bind(this);
    window.addEventListener('keydown', this._keyHandler);

    // Wheel events (Mac trackpad)
    this._wheelHandler = this._onWheel.bind(this);
    this.el.addEventListener('wheel', this._wheelHandler, { passive: false });
  }

  /**
   * Touch handlers
   */
  _onTouchStart(e) {
    if (this.processing || e.touches.length > 1) return;

    const touch = e.touches[0];
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
    this.touchStartTime = Date.now();
    this.touching = true;
  }

  _onTouchMove(e) {
    // Prevent scrolling while swiping a card
    if (this.touching) {
      e.preventDefault();
    }
  }

  _onTouchEnd(e) {
    if (!this.touching || this.processing) return;
    this.touching = false;

    const touch = e.changedTouches[0];
    const dx = touch.clientX - this.touchStartX;
    const dy = touch.clientY - this.touchStartY;
    const dt = Date.now() - this.touchStartTime;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    // Check for double tap first (small movement, fast)
    if (absDx < 20 && absDy < 20 && dt < 400) {
      const timeSinceLastTap = Date.now() - this.lastTapTime;
      const tapDist = Math.abs(touch.clientX - this.lastTapX) +
                      Math.abs(touch.clientY - this.lastTapY);

      if (timeSinceLastTap < 400 && tapDist < 30) {
        // Double tap detected
        if (this.onDoubleTap) {
          this.onDoubleTap();
        }
        this.lastTapTime = 0; // Reset to prevent triple-tap
        return;
      }

      this.lastTapTime = Date.now();
      this.lastTapX = touch.clientX;
      this.lastTapY = touch.clientY;
      return; // Single tap — don't treat as swipe
    }

    // Determine primary direction
    if (absDx < this.threshold && absDy < this.threshold) return;

    let direction;
    if (absDy > absDx) {
      // Vertical swipe
      if (dy < -this.threshold) {
        direction = 'up';
      } else if (dy > this.threshold) {
        direction = 'down';
      }
    } else {
      // Horizontal swipe
      if (dx < -this.threshold) {
        direction = 'left';
      } else if (dx > this.threshold) {
        // Right swipe not used currently
        direction = 'left'; // Right also means undo for now? No, keep it separate
      }
    }

    if (direction && this.onSwipe) {
      this._startProcessing();
      this.onSwipe(direction);
    }
  }

  /**
   * Mouse drag handlers (Mac click-and-drag)
   */
  _onMouseDown(e) {
    if (this.processing) return;
    this.mouseDown = true;
    this.mouseStartX = e.clientX;
    this.mouseStartY = e.clientY;
  }

  _onMouseMove(e) {
    if (!this.mouseDown || this.processing) return;
  }

  _onMouseUp(e) {
    if (!this.mouseDown || this.processing) return;
    this.mouseDown = false;

    const dx = e.clientX - this.mouseStartX;
    const dy = e.clientY - this.mouseStartY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDx < this.threshold && absDy < this.threshold) {
      // Small movement = possible double-click
      const now = Date.now();
      const timeSinceLastClick = now - this.lastTapTime;
      const clickDist = Math.abs(e.clientX - this.lastTapX) +
                        Math.abs(e.clientY - this.lastTapY);

      if (timeSinceLastClick < 400 && clickDist < 20) {
        if (this.onDoubleTap) this.onDoubleTap();
        this.lastTapTime = 0;
        return;
      }

      this.lastTapTime = now;
      this.lastTapX = e.clientX;
      this.lastTapY = e.clientY;
      return;
    }

    let direction;
    if (absDy > absDx) {
      if (dy < -this.threshold) direction = 'up';
      else if (dy > this.threshold) direction = 'down';
    } else {
      if (dx < -this.threshold) direction = 'left';
      else if (dx > this.threshold) direction = 'right';
    }

    if (direction && this.onSwipe) {
      this._startProcessing();
      this.onSwipe(direction);
    }
  }

  /**
   * Keyboard handler (Mac)
   */
  _onKeyDown(e) {
    // Only in game or review screens
    const screen = store.get('screen');
    if (screen !== 'game' && screen !== 'review') return;

    // Don't capture when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (this.processing) return;

    let direction;
    switch (e.key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        direction = 'up';
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        direction = 'down';
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        direction = 'left';
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        direction = 'right';
        break;
      case ' ':
        // Space for double tap (favorite) in game mode
        e.preventDefault();
        if (screen === 'game' && this.onDoubleTap) {
          this._startProcessing();
          this.onDoubleTap();
        }
        return;
      case 'f':
      case 'F':
        if (screen === 'game' && this.onDoubleTap) {
          this._startProcessing();
          this.onDoubleTap();
        }
        return;
      case 'Enter':
        // In review mode, Enter flips the card
        if (screen === 'review') {
          store.emit('review:toggleFlip');
        }
        return;
      default:
        return;
    }

    if (direction && this.onSwipe) {
      e.preventDefault();
      this._startProcessing();
      this.onSwipe(direction);
    }
  }

  /**
   * Wheel handler (Mac trackpad — two-finger swipe)
   */
  _onWheel(e) {
    // Only in game mode
    if (store.get('screen') !== 'game') return;
    if (this.processing) {
      e.preventDefault();
      return;
    }

    const absDx = Math.abs(e.deltaX);
    const absDy = Math.abs(e.deltaY);

    // Need significant movement to count as intentional swipe
    if (absDx < 15 && absDy < 15) return;

    let direction;
    if (absDy > absDx) {
      direction = e.deltaY < 0 ? 'up' : 'down';
    } else {
      direction = e.deltaX < 0 ? 'left' : 'right';
    }

    if (direction && this.onSwipe) {
      e.preventDefault();
      this._startProcessing();
      this.onSwipe(direction);
    }
  }

  /**
   * Start debounce/processing lock
   */
  _startProcessing() {
    this.processing = true;
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this.processing = false;
    }, this.debounceMs);
  }

  /**
   * Update device-specific threshold (called on device change)
   */
  updateThreshold() {
    this.device = store.get('device');
    this.threshold = getSwipeThreshold(this.device);
  }

  /**
   * Clean up all event listeners
   */
  destroy() {
    window.removeEventListener('keydown', this._keyHandler);
    this.el.removeEventListener('wheel', this._wheelHandler);
    // Touch and mouse listeners are on the element itself,
    // which will be garbage collected when the element is removed
  }
}
