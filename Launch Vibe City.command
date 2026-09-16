#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null; then
  echo 'Node.js 22 or newer is required. Install Node, then run this launcher again.'
  read -r '?Press Enter to close.'
  exit 1
fi
if [ ! -d node_modules ]; then npm ci || exit 1; fi
open http://localhost:4173
npm start
read -r '?Server stopped. Press Enter to close.'
