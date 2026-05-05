#!/usr/bin/env bash
# statusline-pokemon.sh — emit a one-line statusline summary for the active vault Pokemon.
#
# Usage: env STOA_VAULT_PATH=<path> [VAULT_POKEMON=<profile-id>] statusline-pokemon.sh
# Wire into Claude Code statusline:
#   "statusLine": { "type": "command", "command": "bash /path/to/statusline-pokemon.sh" }

set -euo pipefail

STOA_VAULT_PATH="${STOA_VAULT_PATH:-}"
if [ -z "$STOA_VAULT_PATH" ]; then
  echo "🛑 STOA_VAULT_PATH unset"
  exit 0
fi

PROFILES="$STOA_VAULT_PATH/_index/profiles.json"
if [ ! -f "$PROFILES" ]; then
  echo "🛑 no profiles.json"
  exit 0
fi

POKEMON="${VAULT_POKEMON:-}"
if [ -z "$POKEMON" ]; then
  POKEMON=$(cat "$PROFILES" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(Object.keys(d)[0]||'')")
fi
if [ -z "$POKEMON" ]; then
  echo "🛑 no profiles"
  exit 0
fi

read -r BARE TYPE TASKS_COMPLETED TASKS_INFLIGHT < <(cat "$PROFILES" | node -e "
const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
const p = d['$POKEMON'];
if (!p) { process.exit(2); }
const bare = p.id.startsWith('profile-') ? p.id.slice('profile-'.length) : p.id;
console.log([bare, p.pokemon_type, p.tasks_completed, p.tasks_in_flight].join(' '));
")

case "$TYPE" in
  fire) EMOJI="🔥";; water) EMOJI="💧";; grass) EMOJI="🌿";;
  electric) EMOJI="⚡";; ghost) EMOJI="👻";; psychic) EMOJI="🔮";;
  dragon) EMOJI="🐉";; dark) EMOJI="🌑";; fairy) EMOJI="✨";;
  fighting) EMOJI="🥊";; ice) EMOJI="❄️";; rock) EMOJI="🪨";;
  ground) EMOJI="⛰️";; flying) EMOJI="🪶";; bug) EMOJI="🐛";;
  poison) EMOJI="☠️";; steel) EMOJI="⚙️";; *) EMOJI="⚪";;
esac

TITLE=$(echo "$BARE" | awk '{print toupper(substr($0,1,1)) tolower(substr($0,2))}')
TASK_LABEL=$( [ "$TASKS_INFLIGHT" -eq 1 ] && echo "task" || echo "tasks" )
echo "$EMOJI $TITLE · $TASKS_INFLIGHT $TASK_LABEL · $TASKS_COMPLETED done"
