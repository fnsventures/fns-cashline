#!/usr/bin/env bash
# Thin wrapper — canonical script lives in fnsventures/petrolpump.
# Fetches main so host-list / auto-fix logic stays in one place.
set -euo pipefail

CANONICAL_URL="${DNS_CHECK_SCRIPT_URL:-https://raw.githubusercontent.com/fnsventures/petrolpump/main/scripts/check-dns-siblings.sh}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command not found: $1" >&2
    exit 2
  fi
}

need_cmd curl

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

if ! curl -fsSL --max-time 30 "$CANONICAL_URL" -o "$tmp"; then
  echo "error: could not download canonical DNS check from:" >&2
  echo "  ${CANONICAL_URL}" >&2
  echo "Clone petrolpump and run: ../petrolPump/scripts/check-dns-siblings.sh $*" >&2
  exit 2
fi

chmod +x "$tmp"
bash "$tmp" "$@"
