#!/usr/bin/env bash
# Renders the production .env from environment variables (set by CI from
# GitHub Secrets/Variables). The keys come from .env.example, so adding a
# setting there is enough for it to be picked up — map it in ci-cd.yml too.
# Prints the file to stdout; never echoes values on error.
set -euo pipefail

REQUIRED=(
  DATABASE_URL
  JWT_ACCESS_SECRET
  JWT_REFRESH_SECRET
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  RESEND_API_KEY
  FRONTEND_URL
)

KEYS=$(grep -oE '^[A-Z][A-Z0-9_]*=' .env.example | tr -d '=')

missing=()
output=""
for key in $KEYS; do
  value="${!key-}"
  if [ -z "$value" ]; then
    # Empty optional settings are omitted so image defaults (e.g. NODE_ENV)
    # are not overridden with an empty string.
    if [[ " ${REQUIRED[*]} " == *" $key "* ]]; then
      missing+=("$key")
    fi
    continue
  fi
  if [[ "$value" == *$'\n'* || "$value" == *"'"* ]]; then
    echo "::error::$key must be a single line without single quotes" >&2
    exit 1
  fi
  # Single quotes: docker compose takes the value literally (spaces, <, #, &).
  output+="$key='$value'"$'\n'
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo "::error::Missing required settings in GitHub: ${missing[*]}" >&2
  exit 1
fi

printf '%s' "$output"
