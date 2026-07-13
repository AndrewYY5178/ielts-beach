// config.js — Environment-aware configuration
//
// Single source of truth for API endpoint.
// In development (served locally), use relative paths.
// In production (deployed to Cloudflare Pages), point to the Worker.
//
// To override: set window.IELTS_API_BASE before app.js loads,
// or the app auto-detects from location.hostname.

export const API_BASE = (() => {
  // Explicit override (for testing / custom deploys)
  if (window.IELTS_API_BASE) return window.IELTS_API_BASE;

  // Local dev or same-origin Pages deployment — use relative paths
  return '/api/v1';
})();

// Word pack CDN base (Cloudflare Pages)
export const WORDS_BASE = (() => {
  if (window.IELTS_WORDS_BASE) return window.IELTS_WORDS_BASE;
  // In local dev, serve from the same origin
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return 'assets/words';
  }
  return 'https://ielts-beach-words.pages.dev';
})();

export const APP_NAME = 'IELTS Beach';
export const APP_VERSION = '1.0.0';
