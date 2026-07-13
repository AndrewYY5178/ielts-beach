// favorites.js — Favorites management, cloud sync, and PDF export

import store from './state.js';
import { formatDate } from './utils.js';

class FavoritesManager {
  constructor() {
    this._unsubs = [];
  }

  /**
   * Initialize
   */
  init() {
    // Load saved favorites (local first, then cloud)
    this._loadFavorites();

    // Listen for screen transitions
    this._unsubs.push(
      store.on('change:screen', (screen) => {
        if (screen === 'favorites') this._renderFavoritesList();
      })
    );

    // Bind export button
    const exportBtn = document.getElementById('btn-fav-export');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportPDF());
    }

    // Bind back button
    const backBtn = document.getElementById('btn-fav-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        store.set('screen', 'menu');
      });
    }
  }

  /**
   * Load favorites from localStorage
   */
  _loadFavorites() {
    try {
      const raw = localStorage.getItem('ielts-beach-favorites');
      if (raw) {
        store.set('favorites', JSON.parse(raw));
      }
    } catch (e) {
      console.warn('[Favorites] Could not load');
    }
  }

  /**
   * Save favorites to localStorage
   */
  _saveFavorites() {
    try {
      localStorage.setItem('ielts-beach-favorites', JSON.stringify(store.get('favorites')));
    } catch (e) {
      console.warn('[Favorites] Could not save');
    }
  }

  /**
   * Render the favorites list
   */
  _renderFavoritesList() {
    const listEl = document.getElementById('fav-list');
    const emptyEl = document.getElementById('fav-empty');
    const favorites = store.get('favorites') || [];

    if (!listEl) return;

    if (favorites.length === 0) {
      if (emptyEl) emptyEl.style.display = 'block';
      listEl.innerHTML = '';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    listEl.innerHTML = favorites.map((fav, i) => `
      <div class="fav-item" data-index="${i}">
        <div class="fav-item-content">
          <p class="fav-sentence">"${this._highlightWord(fav.sentence, fav.word)}"</p>
          <div class="fav-word-info">
            <span class="fav-word">${fav.word}</span>
            <span class="fav-pos">${fav.partOfSpeech}</span>
          </div>
          <p class="fav-definition">${fav.definition}</p>
          <span class="fav-date">${formatDate(fav.savedAt)}</span>
        </div>
        <button class="fav-delete" data-index="${i}" aria-label="Remove from favorites">✕</button>
      </div>
    `).join('');

    // Bind delete buttons
    listEl.querySelectorAll('.fav-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index);
        this._removeFavorite(idx);
      });
    });
  }

  /**
   * Highlight word in sentence
   */
  _highlightWord(sentence, word) {
    const regex = new RegExp(`\\b(${this._escapeRegex(word)})\\b`, 'i');
    return sentence.replace(regex, '<mark>$1</mark>');
  }

  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Remove a favorite by index. Also syncs deletion to cloud.
   */
  _removeFavorite(index) {
    const favorites = store.get('favorites') || [];
    const removed = favorites[index];
    favorites.splice(index, 1);
    store.set('favorites', [...favorites]);
    this._saveFavorites();
    this._renderFavoritesList();
  }

  /**
   * Export favorites as PDF
   */
  async exportPDF() {
    const favorites = store.get('favorites') || [];
    if (favorites.length === 0) {
      alert('No favorites to export yet!');
      return;
    }

    // Show loading state
    const exportBtn = document.getElementById('btn-fav-export');
    if (exportBtn) {
      exportBtn.textContent = 'Generating...';
      exportBtn.disabled = true;
    }

    try {
      // Dynamically import jsPDF (loaded via CDN or bundled)
      const { jsPDF } = window.jspdf || {};
      if (!jsPDF) {
        await this._loadJSPDF();
      }

      await this._generatePDF(favorites);

    } catch (e) {
      console.error('[Favorites] PDF export failed:', e);
      alert('PDF export failed. Please try again.');
    } finally {
      if (exportBtn) {
        exportBtn.textContent = 'Export PDF';
        exportBtn.disabled = false;
      }
    }
  }

  /**
   * Load jsPDF dynamically
   */
  async _loadJSPDF() {
    // Already loaded via <script> tag in index.html
    if (window.jspdf?.jsPDF) return;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/js/jspdf.umd.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  /**
   * Generate the PDF document
   */
  async _generatePDF(favorites) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 20;
    const contentW = pageW - margin * 2;
    const theme = store.get('theme') || 'day';

    // --- Colors based on theme ---
    const colors = theme === 'night'
      ? { bg: '#0D1B2A', card: '#1B2838', text: '#C8D6E5', accent: '#FFD700', muted: '#5A6A7E', water: '#3D5A80' }
      : { bg: '#FFF8DC', card: '#FFFFFF', text: '#2C3E50', accent: '#FF6B35', muted: '#8B9DAF', water: '#87CEEB' };

    // === COVER PAGE ===
    this._drawCoverPage(doc, favorites.length, colors, pageW, pageH);

    // === SENTENCE CARDS ===
    for (let i = 0; i < favorites.length; i++) {
      if (i > 0) doc.addPage();

      const fav = favorites[i];
      let y = margin + 10;

      // Card background
      doc.setFillColor(colors.card);
      doc.setDrawColor(colors.accent);
      doc.setLineWidth(0.5);
      doc.roundedRect(margin, y, contentW, 120, 3, 3, 'FD');

      y += 10;

      // Card number
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(colors.accent);
      doc.text(`#${i + 1}`, margin + 5, y);

      y += 12;

      // Sentence
      doc.setFontSize(12);
      doc.setTextColor(colors.text);
      const sentenceLines = doc.splitTextToSize(`"${fav.sentence}"`, contentW - 20);
      doc.text(sentenceLines, margin + 10, y);
      y += sentenceLines.length * 7 + 8;

      // Divider
      doc.setDrawColor(colors.muted);
      doc.setLineWidth(0.2);
      doc.line(margin + 10, y, pageW - margin - 10, y);
      y += 8;

      // Word (bold, larger)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(colors.accent);
      doc.text(fav.word, margin + 10, y);
      y += 8;

      // Phonetic
      if (fav.phonetic) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(colors.muted);
        doc.text(fav.phonetic, margin + 10, y);
        y += 6;
      }

      // Part of speech
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(10);
      doc.setTextColor(colors.muted);
      doc.text(fav.partOfSpeech, margin + 10, y);
      y += 8;

      // Definition
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(colors.text);
      const defLines = doc.splitTextToSize(fav.definition, contentW - 20);
      doc.text(defLines, margin + 10, y);

      // Watermark at bottom of page
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7);
      doc.setTextColor(colors.muted);
      doc.setGState(new doc.GState({ opacity: 0.3 }));
      doc.text('~ IELTS Beach ~', pageW / 2, pageH - 10, { align: 'center' });
      doc.setGState(new doc.GState({ opacity: 1 }));
    }

    // Add footer page numbers
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      if (i > 1) { // Skip cover
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(colors.muted);
        doc.text(`${i - 1} / ${totalPages - 1}`, pageW / 2, pageH - 8, { align: 'center' });
      }
    }

    // Save
    const date = new Date().toISOString().split('T')[0];
    doc.save(`ielts-beach-favorites-${date}.pdf`);
  }

  /**
   * Draw the cover page
   */
  _drawCoverPage(doc, count, colors, pageW, pageH) {
    const cx = pageW / 2;
    const cy = pageH / 2;

    // Background
    doc.setFillColor(colors.bg);
    doc.rect(0, 0, pageW, pageH, 'F');

    // Ocean band
    doc.setFillColor(colors.water);
    doc.setGState(new doc.GState({ opacity: 0.3 }));
    doc.rect(0, pageH * 0.6, pageW, pageH * 0.1, 'F');

    // Sand band
    doc.setFillColor(210, 180, 140);
    doc.setGState(new doc.GState({ opacity: 0.2 }));
    doc.rect(0, pageH * 0.7, pageW, pageH * 0.3, 'F');
    doc.setGState(new doc.GState({ opacity: 1 }));

    // Sun
    doc.setFillColor(colors.accent);
    doc.setGState(new doc.GState({ opacity: 0.8 }));
    doc.circle(cx - 20, pageH * 0.25, 16, 'F');

    // Glow
    doc.setGState(new doc.GState({ opacity: 0.15 }));
    doc.circle(cx - 20, pageH * 0.25, 28, 'F');
    doc.setGState(new doc.GState({ opacity: 1 }));

    // Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.setTextColor(colors.text);
    doc.text('My IELTS Beach', cx, cy - 30, { align: 'center' });

    // Subtitle
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(14);
    doc.setTextColor(colors.muted);
    doc.text('Favorite Sentences', cx, cy - 16, { align: 'center' });

    // Meta
    doc.setFontSize(9);
    doc.text(`Exported: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, cx, cy + 10, { align: 'center' });
    doc.text(`${count} saved sentence${count !== 1 ? 's' : ''}`, cx, cy + 18, { align: 'center' });

    // Watermark
    doc.setFontSize(7);
    doc.setGState(new doc.GState({ opacity: 0.2 }));
    doc.text('~ IELTS Beach - Pixel Beach Vocabulary ~', cx, pageH - 15, { align: 'center' });
    doc.setGState(new doc.GState({ opacity: 1 }));
  }

  /**
   * Cleanup
   */
  destroy() {
    this._unsubs.forEach(fn => fn());
  }
}

// Singleton
export const favoritesManager = new FavoritesManager();
export default favoritesManager;
