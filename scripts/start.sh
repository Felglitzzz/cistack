#!/bin/sh
# Starts the cistack coordinator so you can step away from the machine. Run it inside
# the target project: sh start.sh [extra claude flags]
#   --remote-control        answer permission prompts and questions in the Claude app
#   --permission-mode auto  ask far less often (extra flags can override it)
#   caffeinate -i           on macOS, no idle sleep (a closed lid still sleeps)
set -eu

# Run from a cistack checkout, load that checkout rather than an installed copy.
plugin=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$(git rev-parse --show-toplevel)"

# --channels takes a list, so it goes last. /cistack:wake-up has to come first.
if [ -f .cistack/discord.json ]; then
  set -- "$@" --channels plugin:discord@claude-plugins-official
fi
if grep -q '"name": *"cistack"' "$plugin/.claude-plugin/plugin.json" 2>/dev/null; then
  set -- --plugin-dir "$plugin" "$@"
fi
# The model the owner chose for the coordinator, if they chose one. This reads the
# settings file directly: a copy of this script may have no cistack checkout beside it.
if [ -f .cistack/settings.json ]; then
  model=$(sed -n 's/.*"coordinator" *: *"\([^"]*\)".*/\1/p' .cistack/settings.json | head -n 1)
  case "$model" in
    "") ;;
    opus | sonnet | haiku | fable) set -- --model "$model" "$@" ;;
    *) echo "The coordinator's model in .cistack/settings.json is \"$model\". Use opus, sonnet, haiku or fable." >&2; exit 1 ;;
  esac
fi
set -- claude /cistack:wake-up --agent cistack:coordinator --remote-control --permission-mode auto "$@"

if command -v caffeinate >/dev/null 2>&1; then
  set -- caffeinate -i "$@"
fi
exec "$@"
