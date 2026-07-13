# IELTS Beach

Learn IELTS vocabulary through sentences. Offline-first, focused, minimal.

**Live Site**: https://andrewyy5178.github.io/ielts-beach/

## Features

- **Swipe to Learn** — Swipe ↑ known, ↓ unknown, ← undo
- **10-Second Timer** — Auto-marks unknown words on timeout
- **Smart Review** — Accumulates unknown words, triggers card-flip review
- **Favorites** — Double-tap to save, export as PDF
- **Offline PWA** — Install on any device, works without internet
- **Cross-Device Sync** — Passphrase-based sync via Cloudflare Worker + D1

## How to Run

```bash
cd public
npx serve . -p 8080
# Open http://localhost:8080
```

## Gestures & Controls

| Action | Touch | Keyboard |
|--------|-------|----------|
| Know it | Swipe ↑ | `↑` or `W` |
| Don't know | Swipe ↓ | `↓` or `S` |
| Undo | Swipe ← | `←` or `A` |
| Favorite | Double-tap | `Space` or `F` |

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JS (zero framework, only jsPDF for export)
- **Design**: DM Sans + Inter + Noto Sans SC, glass cards, dark mode (#39393A + #81C048)
- **Backend**: Cloudflare Worker + D1 (lightweight sync, ~130 lines)
- **Auth**: Passphrase → SHA-256 sync key
- **Storage**: IndexedDB (primary) + D1 (cloud sync)

## Project Structure

```
ielts-beach/
├── public/                  # Frontend (PWA)
│   ├── index.html           # Single-page entry point
│   ├── css/                 # 12 CSS files
│   ├── js/                  # 12 JS modules
│   ├── sw.js                # Service Worker
│   ├── manifest.json        # PWA manifest
│   └── assets/words/        # 3000-word IELTS bank
├── worker/                  # Cloudflare Worker
│   ├── src/index.js         # Sync endpoint (~130 lines)
│   └── migrations/          # D1 schema
└── scripts/                 # Build tools
```

## License

MIT
