// utils.js — Shared helpers

/**
 * Generate a simple UUID v4
 */
export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/**
 * Clamp a number between min and max
 */
export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Debounce a function
 */
export function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Detect device type from user agent
 */
export function detectDevice() {
  const ua = navigator.userAgent;
  // iPad detection: iPadOS 13+ reports as Macintosh
  const isIPad = /iPad/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isIPhone = /iPhone/.test(ua);
  const isMac = /Macintosh/.test(ua) && !isIPad;

  if (isIPhone) return 'iphone';
  if (isIPad) return 'ipad';
  if (isMac) return 'mac';
  return 'other';
}

/**
 * Get swipe threshold based on device
 */
export function getSwipeThreshold(device) {
  switch (device) {
    case 'iphone': return 50;
    case 'ipad':   return 60;
    case 'mac':    return 40; // mouse is more precise
    default:       return 50;
  }
}

/**
 * Format date as ISO-like string for display
 */
export function formatDate(date) {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

/**
 * Simple hash function for PIN storage (not cryptographically secure,
 * but adequate for this use case; backend will use proper hashing)
 */
export async function hashPin(pin, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + salt);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Get time period name based on local hour
 */
export function getTimePeriod(hour) {
  if (hour >= 5 && hour < 8)  return 'dawn';
  if (hour >= 8 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 20) return 'dusk';
  return 'night';
}

/**
 * Map Open-Meteo weather code to our scene type
 * https://open-meteo.com/en/docs#weathervariables
 */
export function mapWeatherCode(code) {
  if (code === 0)                     return 'clear';
  if (code >= 1 && code <= 3)        return 'partly-cloudy';
  if (code === 45 || code === 48)    return 'fog';
  if (code >= 51 && code <= 57)      return 'rain';
  if (code >= 61 && code <= 67)      return 'rain';
  if (code >= 71 && code <= 77)      return 'snow';
  if (code >= 80 && code <= 82)      return 'rain';
  if (code >= 85 && code <= 86)      return 'snow';
  if (code >= 95 && code <= 99)      return 'storm';
  return 'clear'; // default
}
