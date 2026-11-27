#!/usr/bin/env bash
# Scala prywatne repo damianx9x/sentencedbot-rekrutacja do legacy/ z pełną historią.
# UWAGA: The-Sentenced jest PUBLICZNE. Skrypt zatrzymuje się, jeśli znajdzie podejrzane sekrety.
set -euo pipefail
SRC="git@github.com:damianx9x/sentencedbot-rekrutacja.git"
git diff --quiet || { echo 'Masz niezacommitowane zmiany — przerwij.'; exit 1; }
git checkout -B chore/merge-rekrutacja
git remote get-url rekrutacja >/dev/null 2>&1 || git remote add rekrutacja "$SRC"
git fetch rekrutacja main feat/election-foundations-20261122
git subtree add --prefix=legacy/rekrutacja rekrutacja main -m 'Merge sentencedbot-rekrutacja (main) into legacy/rekrutacja'
git subtree add --prefix=legacy/rekrutacja-elections rekrutacja feat/election-foundations-20261122 -m 'Merge sentencedbot-rekrutacja (elections branch) into legacy/rekrutacja-elections'
echo '--- Skan sekretów w legacy/ ---'
PATTERN='([MN][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,})|(DISCORD_TOKEN *= *[^ ]+)|(BEGIN [A-Z ]*PRIVATE KEY)|(\b(10|192\.168|172\.(1[6-9]|2[0-9]|3[01]))\.[0-9]+\.[0-9]+)|(TunnelSecret)'
if grep -RInE "$PATTERN" legacy/; then
  echo 'ZNALEZIONO potencjalne sekrety/adresy — usuń je (i z historii) zanim zrobisz push!'; exit 2
fi
echo 'Czysto. Przejrzyj: git log --oneline -20 && git push -u origin chore/merge-rekrutacja'
