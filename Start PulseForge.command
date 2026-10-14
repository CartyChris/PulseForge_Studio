#!/bin/bash
# PulseForge Studio launcher for macOS.
# Double-click to start the backend + studio and open it in your browser.
set -u
cd "$(dirname "$0")"

fail() {
  echo ""
  echo "──────────────────────────────────────────────"
  echo "  PulseForge could not start."
  echo "  $1"
  echo ""
  echo "  Troubleshooting:"
  echo "   • Install Node.js 20 or newer from https://nodejs.org"
  echo "   • Then open Terminal in this folder and run:  npm install"
  echo "   • Start manually with:                        npm run start"
  echo "   • More help: TROUBLESHOOTING.md in this folder"
  echo "──────────────────────────────────────────────"
  read -r -p "Press Enter to close…"
  exit 1
}

command -v node >/dev/null 2>&1 || fail "Node.js was not found on this Mac."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js $NODE_MAJOR is too old (need 20+)."

if [ ! -d node_modules ]; then
  echo "[pulseforge] first run — installing dependencies (one time)…"
  npm install || fail "npm install failed. Check your internet connection."
fi

echo "[pulseforge] starting PulseForge Studio…"
npm run start || fail "The PulseForge server exited with an error (see messages above)."
