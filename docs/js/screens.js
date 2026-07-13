// screens.js — Screen lifecycle management

import store from './state.js';

class ScreenManager {
  constructor() {
    this.screens = new Map();
    this.currentScreen = null;
    this._unsubs = [];
  }

  init() {
    const screenIds = ['welcome', 'menu', 'game', 'review', 'favorites', 'wordbank', 'settings'];
    for (const id of screenIds) {
      const el = document.getElementById(`screen-${id}`);
      if (el) this.screens.set(id, el);
    }

    this._unsubs.push(
      store.on('change:screen', (screen) => this.showScreen(screen))
    );

    const currentId = store.get('screen');
    this.showScreen(currentId);
  }

  showScreen(screenId) {
    if (this.currentScreen === screenId) return;

    const newScreen = this.screens.get(screenId);
    if (!newScreen) {
      console.warn(`[Screens] Unknown screen: ${screenId}`);
      return;
    }

    // Exit current
    if (this.currentScreen) {
      const old = this.screens.get(this.currentScreen);
      if (old) {
        old.classList.add('screen-exit');
        old.classList.remove('screen-active');
        setTimeout(() => old.classList.remove('screen-exit'), 300);
      }
    }

    // Enter new
    newScreen.classList.remove('hidden');
    void newScreen.offsetWidth;
    newScreen.classList.add('screen-active');

    document.body.setAttribute('data-screen', screenId);

    // Update nav pill active state
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.screen === screenId);
    });

    this.currentScreen = screenId;
    store.emit(`screen:enter:${screenId}`);
  }

  destroy() {
    this._unsubs.forEach(fn => fn());
  }
}

export const screenManager = new ScreenManager();
export default screenManager;
