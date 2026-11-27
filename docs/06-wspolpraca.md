# 06 — Jak współpracujemy na repo

## Gałęzie
- `main` — zawsze zielone CI, to co może iść na Pi i do wydania addonu.
- `feat/<krótki-opis>`, `fix/<…>`, `docs/<…>` — jedna zmiana na gałąź.

## Cykl pracy
1. Issue (szablon: `.github/ISSUE_TEMPLATE/bug.md`) — wersja gry i addonu, kroki, oczekiwany wynik.
2. Gałąź z `main`, mała zmiana + test.
3. `make test` lokalnie.
4. PR (szablon `.github/pull_request_template.md`): co, dlaczego, wynik testów, zrzut ekranu dla UI, sekcja **Wdrożenie** (czy trzeba ruszyć Pi / Discord / wydać addon) i **Rollback**.
5. Review przez drugą osobę lub właściciela (@damianx9x). Merge: squash.
6. Wdrożenie na Pi robi admin wg `docs/04-…`.

## Praca z AI (Codex, Claude, Cursor)
- Agent czyta `AGENTS.md` (Claude: `CLAUDE.md` → `AGENTS.md`).
- Agent pracuje na gałęzi i otwiera PR — nigdy nie merguje sam do `main` bez zgody człowieka.
- Agent nie dostaje tokenu bota, SSH do Pi ani dostępu do produkcyjnego Discorda.
- Każda luka w wiedzy agenta → pytanie do człowieka → odpowiedź dopisana do `docs/FAQ.md`.

## Dostęp dla współpracowników
- Repo publiczne: każdy może zrobić fork + PR.
- Uprawnienie „Write” dla zaufanych osób: GitHub → Settings → Collaborators.
- Zalecane: Settings → Branches → reguła dla `main`: wymagany PR, wymagany check „Verify The Sentenced”, zakaz force-push.

## Wersjonowanie
- Bot: `runtime/package.json` `version` + `runtime/system-version.json`.
- Addon: `## Version` w `addon/TheSentenced/TheSentenced.toc`.
- Tag wydania addonu: `addon-v<wersja>`; bota: `bot-v<wersja>`.
