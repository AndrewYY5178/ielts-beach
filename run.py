#!/usr/bin/env python3
"""
IELTS Beach — One-click launcher for Mac
Starts a local server and opens the app in your browser.
"""
import http.server
import socketserver
import webbrowser
import subprocess
import os
import sys
import signal

PORT = 8080
DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public')

# Change to the public directory
os.chdir(DIR)

# Try to open in Chrome app mode first (no tabs/address bar — feels like a native app)
try:
    chrome_paths = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]
    chrome = None
    for p in chrome_paths:
        if os.path.exists(p):
            chrome = p
            break

    if chrome:
        subprocess.Popen([
            chrome,
            f'--app=http://localhost:{PORT}/index.html',
            '--window-size=420,820',
        ])
    else:
        # Fallback: use default browser
        webbrowser.open(f'http://localhost:{PORT}')
except Exception:
    webbrowser.open(f'http://localhost:{PORT}')

# Start the server
Handler = http.server.SimpleHTTPRequestHandler

# Suppress noisy logs
class QuietHandler(Handler):
    def log_message(self, format, *args):
        pass  # silent

print(f'''
╔══════════════════════════════════╗
║        🏝  IELTS Beach           ║
║                                  ║
║  App opened in your browser!     ║
║                                  ║
║  If Chrome didn't open:          ║
║  → http://localhost:{PORT}          ║
║                                  ║
║  Press Ctrl+C here to quit.      ║
╚══════════════════════════════════╝
''')

try:
    with socketserver.TCPServer(("", PORT), QuietHandler) as httpd:
        httpd.serve_forever()
except KeyboardInterrupt:
    print('\n👋 Goodbye!')
    sys.exit(0)
