// auth.js — Passphrase-based identity (offline-first, sync key derivation)

import store from './state.js';

class AuthManager {
  /**
   * Derive a sync key from passphrase using SHA-256
   */
  async _deriveKey(passphrase) {
    const encoder = new TextEncoder();
    const data = encoder.encode(passphrase);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Set passphrase — derives sync key and saves to localStorage
   */
  async setPassphrase(passphrase) {
    if (!passphrase || passphrase.length < 4) {
      return { success: false, error: 'Passphrase must be at least 4 characters' };
    }
    const syncKey = await this._deriveKey(passphrase);
    const identity = { syncKey, createdAt: Date.now() };
    localStorage.setItem('ielts-beach-identity', JSON.stringify(identity));
    store.set('identity', identity);
    return { success: true };
  }

  /**
   * Verify passphrase matches stored sync key
   */
  async verifyPassphrase(passphrase) {
    const stored = this.getIdentity();
    if (!stored) return false;
    const syncKey = await this._deriveKey(passphrase);
    return syncKey === stored.syncKey;
  }

  /**
   * Get stored identity
   */
  getIdentity() {
    try {
      const raw = localStorage.getItem('ielts-beach-identity');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Check if user has already set up a passphrase
   */
  isSetup() {
    return !!this.getIdentity();
  }

  /**
   * Clear identity (reset)
   */
  clear() {
    localStorage.removeItem('ielts-beach-identity');
    store.set('identity', null);
  }
}

export const authManager = new AuthManager();
export default authManager;
