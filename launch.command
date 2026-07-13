#!/bin/bash
# IELTS Beach — Double-click to launch!
cd "$(dirname "$0")"

echo "╔══════════════════════════════════╗"
echo "║        🏝  IELTS Beach           ║"
echo "║                                  ║"
echo "║  1) Local dev   (localhost:8080) ║"
echo "║  2) Online      (pages.dev)      ║"
echo "╚══════════════════════════════════╝"
echo ""
read -p "Choose [1/2, default=2]: " choice

if [ "$choice" = "1" ]; then
    echo "Starting local server..."
    python3 run.py
else
    echo "Opening online version..."
    open "https://ielts-beach.pages.dev" 2>/dev/null || open "https://4823bea8.ielts-beach.pages.dev"
    echo "Done! App opened in your browser."
fi
