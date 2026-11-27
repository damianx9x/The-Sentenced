# CLAUDE.md

Pełne instrukcje dla agentów są w **[AGENTS.md](AGENTS.md)** — przeczytaj go w całości przed jakąkolwiek zmianą. Ten plik istnieje, bo Claude Code wczytuje `CLAUDE.md` automatycznie.

Najważniejsze w skrócie:
- Repo jest publiczne: zero sekretów, IP, `.env`, baz SQLite, danych graczy.
- Kod bota: `runtime/` (Node 24, discord.js 14). Addon: `addon/TheSentenced` (Lua 5.1, interfejs 16001). Most Mac: `mac/roster_sync.py`.
- Kanały Discord tylko przez `runtime/guild-channel-ids.cjs`, nigdy po nazwie.
- Testy: `make test` (lub komendy z AGENTS.md §2). Wszystko musi być zielone.
- Nie wdrażasz na Raspberry Pi i nie zmieniasz uprawnień Discord — przygotowujesz kod i instrukcję dla człowieka.
- Dokumentacja: `docs/` (spis: `docs/README.md`).
