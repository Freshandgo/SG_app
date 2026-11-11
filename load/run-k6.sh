#!/usr/bin/env bash
# Lance le test de charge k6 sur le frontend et sauvegarde la sortie.
# Usage : ./load/run-k6.sh            (URL lue depuis terraform output)
#         ./load/run-k6.sh https://... (URL forcée)
set -euo pipefail

# Se placer à la racine du repo (git/sg_app), quel que soit le dossier d'appel.
cd "$(dirname "$0")/.."

SCRIPT="load/k6-frontend-test.js"
LOG="load/run-scaling-test.txt"

command -v k6 >/dev/null || { echo "k6 introuvable dans le PATH" >&2; exit 1; }

URL="${1:-$(terraform -chdir=infra output -raw frontend_url)}"
if [[ -z "$URL" || "$URL" != https://* ]]; then
  echo "URL invalide : '$URL'" >&2
  exit 1
fi

echo "Cible : $URL"
if ! curl -fsS -o /dev/null "$URL/health"; then
  echo "$URL/health ne répond pas 200 — test annulé" >&2
  exit 1
fi

k6 run -e BASE_URL="$URL" "$SCRIPT" 2>&1 | tee "$LOG"
echo "Log sauvegardé dans $LOG"
