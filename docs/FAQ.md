# FAQ — znane problemy i szybkie odpowiedzi

**Nowy członek nie widzi czatu.** Sprawdź nadpisanie `Member` → `ViewChannel` (1024) na kanale. Kadra tego nie zauważy, bo ma własne uprawnienia. Patrz `02-discord.md` (incydent 2026-11-23).

**Po akceptacji regulaminu „Nie można kontynuować”.** Bot nie znalazł kanału. Kod musi używać ID z `runtime/guild-channel-ids.cjs`; sprawdź, czy kanał nie został usunięty i utworzony na nowo (nowe ID).

**Nadawanie ról kończy się 403.** Rola bota jest niżej niż nadawana rola — przesuń rolę bota wyżej.

**Bot nie wita w czacie gildii w grze.** To ograniczenie Discorda (403, kod 20062) — nie naprawiamy.

**Addon nie widzi zmian z Discorda.** Zrób `/reload` (zapis i odczyt SavedVariables). Bez Maca z mostem użyj ręcznej synchronizacji `/bot → Addon → Synchronizacja dodatku`.

**Gdzie jest `deploy-commands.js`?** Tylko na Pi. Jeśli zmieniasz komendy slash, opisz w PR, że admin musi uruchomić `npm run deploy`. Docelowo przenieść do repo (bez tokenu).

**Które pliki są duplikatami?** `payload/`, `recruitment/`, `roster/` w korzeniu = stare kopie. Kanoniczne: `runtime/…`.

**Czy mogę wrzucić logi z Pi do issue?** Tylko po usunięciu ID użytkowników, nicków i treści wniosków.

**Agent AI czegoś nie wie.** Zapytaj człowieka i dopisz odpowiedź tutaj w tym samym PR.
