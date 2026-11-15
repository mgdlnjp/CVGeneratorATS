#!/bin/bash
# Ouvre CV Generator ATS dans un onglet de Google Chrome.
# Le serveur tourne dans cette fenêtre Terminal : la fermer (ou Ctrl+C) l'arrête.
cd "$(dirname "$0")"
PORT="${PORT:-3456}"
URL="http://localhost:$PORT"

open_tab() {
  if [ -d "/Applications/Google Chrome.app" ]; then open -a "Google Chrome" "$URL"; else open "$URL"; fi
}

# Serveur déjà lancé : on ouvre juste l'onglet
if curl -s -o /dev/null "$URL"; then
  open_tab
  exit 0
fi

(for _ in $(seq 1 20); do curl -s -o /dev/null "$URL" && break; sleep 0.25; done; open_tab) &
exec node server.js
