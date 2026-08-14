#!/usr/bin/env bash
# PostToolUse hook: typecheck the package containing an edited TypeScript file
# so type errors surface immediately instead of at phase end.
# Receives the tool-use JSON on stdin; exits 0 silently when not applicable.
set -uo pipefail

INPUT="$(cat)"
FILE_PATH="$(printf '%s' "$INPUT" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"

case "$FILE_PATH" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

# Walk up from the file to the nearest package.json with a typecheck script.
DIR="$(dirname "$FILE_PATH")"
while [ -n "$DIR" ] && [ "$DIR" != "/" ]; do
  if [ -f "$DIR/package.json" ] && grep -q '"typecheck"' "$DIR/package.json"; then
    cd "$DIR" || exit 0
    OUTPUT="$(pnpm run typecheck 2>&1)"
    STATUS=$?
    if [ $STATUS -ne 0 ]; then
      echo "typecheck failed for $DIR:" >&2
      echo "$OUTPUT" | tail -n 40 >&2
      exit 2
    fi
    exit 0
  fi
  DIR="$(dirname "$DIR")"
done

exit 0
