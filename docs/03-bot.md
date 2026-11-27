# 03 — SentencedBot: kod, konfiguracja, działanie

Wersja: **3.0.1** (`runtime/package.json`, `runtime/system-version.json`, status `development`, protocol 1, interface 16001).

## Uruchomienie
- Wejście: `runtime/index.js` (`npm start` → `node index.js`).
- Zależności: `discord.js ^14.27`, `better-sqlite3`, `dotenv`, `luxon` (strefy/daty, Europe/Warsaw), `cheerio` (parsowanie newsów WoW Forever).
- Node **24** (CI), lokalnie min. 22.
- Konfiguracja przez `.env` w katalogu bota na Pi (wczytywany przez `dotenv`). **`.env` nigdy w repo.**

### Zmienne środowiskowe (nazwy; wartości tylko na Pi)
| Zmienna | Znaczenie |
|---|---|
| token bota Discord (np. `DISCORD_TOKEN`) | logowanie bota — sprawdź dokładną nazwę w `.env` na Pi i dopisz tutaj |
| `TS_ONBOARDING_V6_ENABLED=true` | włącza nową rekrutację v6 zamiast starej |
| `TS_RECRUITMENT_RULES_URL` | opcjonalny publiczny adres regulaminu pokazywany w panelu |

> Agent AI: jeśli potrzebujesz innej zmiennej, wyszukaj `process.env.` w `runtime/` — to jest pełna lista. Nie wymyślaj nazw.

## Moduły `runtime/`
| Plik / katalog | Odpowiedzialność |
|---|---|
| `index.js` | start klienta discord.js, rejestracja handlerów, komend slash, interakcji, harmonogramów |
| `guild-channel-ids.cjs` | ID serwera, kanałów, kanałów klasowych, kanały panelu Kadra |
| `ts-onboarding-v6/` | rekrutacja v6 (patrz niżej) |
| `recruitment/public.cjs`, `projection.cjs`, `welcome.cjs`, `wow-welcome.cjs`, `invite-contacts.cjs` | publiczny widok rekrutacji, projekcja wniosków, powitania (Discord i próba w grze) |
| `election/` (`engine`, `nominations`, `lifecycle`, `store`, `outbox`, `discord`, `messages`, `access`, `runtime`) | wybory gildyjne: nominacje, prywatne liczenie głosów, odzyskiwanie po restarcie, bramki uprawnień |
| `roster/` (`receive`, `import`, `discord`) | przyjmowanie rosteru z addonu przez most, import do bazy, publikacja |
| `guild-tables.cjs`, `guild-composition.cjs`, `guild-history.js`, `guild-milestones.js`, `guild-identity.js` | tabele i statystyki gildii, historia, kamienie milowe, tożsamość gracz↔postać |
| `guild-staff.cjs`, `staff-local-bridge.cjs` | zadania kadry, most lokalny dla panelu Kadra |
| `guild-hub.js`, `guild-ops-v3.js`, `guild-actions.cjs`, `guild-core.js`, `guild-promotions.cjs`, `guild-refresh.cjs`, `guild-notifications.js` | operacje gildii, awanse, odświeżanie układu, powiadomienia |
| `guild-addon.cjs`, `integration-service.cjs`, `companion-api.cjs`, `device-api.cjs`, `companion/` | integracja z addonem: parowanie, synchronizacja, panel companion (HTML/JS/CSS) |
| `transfer-sync.cjs` | synchronizacja transferów (pary z `addon/TheSentenced/TransferSync.lua`) |
| `raid-create.cjs`, `raid-links.cjs`, `raid-reminders.js`, `raid-signup-view.cjs`, `lfg-actions.cjs` | raidy, zapisy, przypomnienia, LFG |
| `polls.js` | ankiety |
| `forever-watcher.js`, `forever-news-v2.js`, `news/policy.cjs` | obserwacja i publikacja newsów WoW Forever |
| `community.js`, `ekipa-www.js`, `reddit-memes.js`, `meme-policy.cjs`, `assets/` | społeczność, zespół na stronie, memy |
| `profile-discord.cjs` | profile graczy na Discordzie |
| `delivery-guard.js`, `maintenance.cjs` | ochrona przed podwójnym wysłaniem, tryb serwisowy |

## Rekrutacja v6 (`runtime/ts-onboarding-v6/`)
Pliki: `policy.cjs` (czysta logika, bez I/O), `gate-store.cjs` (SQLite), `wizard.cjs` (kreator), `discord-payloads.cjs` (wiadomości/przyciski), `acl-oracle.cjs` (oczekiwane ACL), `ts-onboarding-runtime.cjs` (spina wszystko), `content/regulamin.md`.

### Stany
`JOINED → AWAIT_TERMS → TERMS_ACCEPTED → DRAFT → SUBMITTED → GRANTING → APPROVED` (lub `REJECTED`).

### Reguły (`policy.cjs`)
- ID użytkownika i serwera: 17–20 cyfr.
- Formularz dostępny tylko gdy: `pending === false` (Screening), aktywna zgoda na **bieżący** hash regulaminu, stan `TERMS_ACCEPTED` lub `DRAFT`.
- Gałąź **TAK** (był członkiem): wymagany `oldNick` (≤60 znaków).
- Gałąź **NIE**: `firstName` (≤80), `age` 1–120, `wowClass`, `race`, `spec` (≤80), `professions` ≤3, `playstyles` 1–3 z {`Casual`, `Raidowanie`, `PvP`}, `raidPlan` true/false; gdy true: `raidHoursWeek` (0–168] i `raidDays` z {pon, wt, sr, czw, pt, sob, nd}; opcjonalnie `about` ≤1200.
- Akceptacja: tylko `SUBMITTED`, autoryzowany człowiek (nie bot) z tego serwera, **nie sam kandydat**, kandydat nadal na serwerze.
- Nadanie ról (`GRANTING`) wymaga zweryfikowanej decyzji kadry; powitanie tylko gdy obie role potwierdzone i jeszcze nie witano.

### Dane i awarie
SQLite przechowuje zgodę (SHA-256 + wersja) i wnioski. Karta w `#oficerka` jest powiązana przez ID wiadomości i rewizję. Operacje zapisu ról i karty są warunkowe (compare-and-set). Przy przerwaniu w `GRANTING` bot musi uzgodnić faktyczne role po restarcie. Dane osobowe (imię, wiek) widzi tylko kadra; powiadomienia ich nie zawierają.

## Testy
`tests/*.test.cjs` (Node test runner, symulowany Discord, SQLite in-memory), `tests/test_*.py` (most Mac). Uruchom `make test-bot`.

## Dodawanie funkcji — wzorzec
1. Logika czysta (bez Discorda) w osobnym module `.cjs` → test jednostkowy.
2. Warstwa Discord osobno (payloady, handlery).
3. Kanały przez `channelId(guild, 'klucz')`.
4. `allowedMentions: { parse: [] }` dla treści od użytkowników.
5. Odpowiedź na interakcję w ≤3 s (`deferReply`/`deferUpdate` przy dłuższych operacjach).
