#!/bin/bash
# Ouvre CV Generator ATS dans sa propre fenêtre (sans onglets ni barre d'adresse).
# Le serveur s'arrête quand on ferme la fenêtre.
cd "$(dirname "$0")"
PORT="${PORT:-3456}"
URL="http://localhost:$PORT"
PROFILE_DIR="$HOME/Library/Application Support/CV Generator ATS"

# Démarre le serveur s'il ne tourne pas déjà
STARTED=""
if ! curl -s -o /dev/null "$URL"; then
  node server.js &
  STARTED=$!
  for _ in $(seq 1 20); do curl -s -o /dev/null "$URL" && break; sleep 0.25; done
fi

# Fenêtre « application » : Chrome, sinon Brave, sinon le navigateur par défaut
APP=""
for b in "Google Chrome" "Brave Browser"; do
  [ -d "/Applications/$b.app" ] && APP="$b" && break
done

if [ -n "$APP" ]; then
  open -W -na "$APP" --args --app="$URL" --user-data-dir="$PROFILE_DIR" \
    --window-size=1440,900 --no-first-run --no-default-browser-check
else
  open "$URL"
  [ -n "$STARTED" ] && wait "$STARTED"
fi

[ -n "$STARTED" ] && kill "$STARTED" 2>/dev/null
exit 0
