# AGENTS.md — instrukcja dla agentów AI (Codex, Claude Code, Cursor, Copilot, Aider…)

> Czytasz to jako pierwszy plik. Wszystko, czego potrzebujesz, jest w tym pliku i w `docs/`. Nie zgaduj — jeśli czegoś tu nie ma, zapytaj człowieka i dopisz odpowiedź do `docs/FAQ.md` w tym samym PR.

## 0. Czym jest to repo (jedno zdanie)
Monorepo gildii **The Sentenced** (World of Warcraft: Forever, serwer PL): **bot Discord SentencedBot** (`runtime/`, Node.js 24, discord.js 14, SQLite), **dodatek WoW „Guild Hall”** (`addon/TheSentenced`, Lua 5.1, interfejs 16001), **most Mac ↔ bot** (`mac/roster_sync.py`) oraz dokumentacja serwera Discord i infrastruktury Raspberry Pi (`docs/`).

## 1. Mapa repozytorium (źródło prawdy)
| Ścieżka | Co to jest | Kanoniczne? |
|---|---|---|
| `runtime/` | Kod bota uruchamiany na Raspberry Pi (`index.js` = wejście, ~190 KB) | TAK |
| `runtime/ts-onboarding-v6/` | Rekrutacja v6: regulamin, kreator TAK/NIE, maszyna stanów, SQLite | TAK |
| `runtime/election/` | Wybory gildyjne (nominacje, prywatne głosowanie, outbox) | TAK |
| `runtime/recruitment/`, `runtime/roster/` | Rekrutacja publiczna, powitania, import rosteru z addonu | TAK |
| `runtime/companion/` + `companion-api.cjs`, `device-api.cjs` | Lokalny panel/companion i API dla urządzeń (most z addonem) | TAK |
| `runtime/guild-channel-ids.cjs` | **Jedyne** mapowanie nazw logicznych → ID kanałów Discord | TAK |
| `addon/TheSentenced/` | Dodatek WoW (kolejność ładowania = `TheSentenced.toc`) | TAK |
| `addon/tests/` | Testy LuaJIT addonu + `verify_*.py` | TAK |
| `mac/roster_sync.py` | Synchronizator na Macu (co 15 s, SavedVariables ↔ bot) | TAK |
| `tests/` | Testy Node (`*.test.cjs`) i Python (`test_*.py`) bota/mostu | TAK |
| `data/forever-catalog.json` | Katalog instancji/przedmiotów WoW Forever | TAK |
| `payload/`, `recruitment/`, `roster/` (w korzeniu) | **Duplikaty historyczne** plików z `runtime/` | NIE — nie edytuj, edytuj `runtime/` |
| `legacy/rekrutacja/` | (po uruchomieniu `scripts/merge-rekrutacja.sh`) historia repo `sentencedbot-rekrutacja`: patche, deploy na Pi, audyty | Archiwum |
| `docs/` | Dokumentacja dla ludzi i AI | TAK |

## 2. Komendy (uruchamiaj z korzenia repo)
```sh
make setup        # npm ci w runtime/ + fonttools
make test         # wszystko: bot + addon
make test-bot     # node --test tests/*.test.cjs + python unittest
make test-addon   # luajit addon/tests/*.lua + luac5.1 -p + verify_assets/catalog
make build-addon  # ZIP do /tmp/TheSentenced.zip
```
Bez `make` (dokładnie to robi CI `.github/workflows/verify.yml`):
```sh
npm ci --prefix runtime --no-audit --no-fund
NODE_PATH="$PWD/runtime/node_modules" node --test tests/*.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py'
cd addon && for t in tests/*.lua; do luajit "$t" || exit 1; done
for s in TheSentenced/*.lua; do luac5.1 -p "$s"; done
python3 tests/verify_assets.py && python3 tests/verify_catalog.py
python3 build.py /tmp/TheSentenced.zip
```
Wymagania: Node 24, Python 3.13 (min. 3.10), LuaJIT, `lua5.1` (luac5.1), `pip install fonttools`. Testy NIE wymagają Discorda, WoW ani Raspberry Pi.

## 3. Twarde zasady (złamanie = odrzucony PR)
1. **Repo jest PUBLICZNE.** Nigdy nie commituj: tokenu bota, `.env`, plików `*.db`/`*.sqlite`, `WTF/`/SavedVariables, adresów IP/hostów Pi, nazw użytkowników SSH, konfiguracji cloudflared (`credentials.json`, `cert.pem`, ID tunelu), danych osobowych graczy (imię, wiek z formularzy rekrutacyjnych). W testach używaj danych fikcyjnych.
2. **ID Discord są stałe, nazwy nie.** Kod odwołuje się do kanałów przez nazwę logiczną z `runtime/guild-channel-ids.cjs` (`channelId(guild, 'regulamin')`), nigdy przez wyświetlaną nazwę kanału. Kanały były już przemianowane (np. `rules`→`regulamin`, `poczekalnia`→`rekrutacja`, `addony`→`addon-the-sentenced`) i szukanie po nazwie psuło bota.
3. **Nie zmieniaj uprawnień Discord z kodu bez trybu dry-run.** Każdy skrypt zmieniający ACL: domyślnie podgląd, `--apply` robi backup JSON, `--rollback <plik>` przywraca.
4. **Rekrutacja to maszyna stanów** (`runtime/ts-onboarding-v6/src/policy.cjs`). Nie dodawaj przejść omijających `policy.cjs`. Brak samo-akceptacji (`SELF_APPROVAL`), zgoda na regulamin wiązana z hashem SHA-256 wersji regulaminu.
5. **Addon: kolejność plików** w `TheSentenced.toc` jest znacząca. Nowy plik `.lua` = wpis w `.toc` + test w `addon/tests/` + przejście `luac5.1 -p` (składnia Lua 5.1, bez `goto`, bez `//`).
6. **Interfejs WoW Forever = 16001.** Nie podnoś `## Interface` bez potwierdzenia człowieka.
7. **Jedna zmiana na PR**, gałąź `feat/…`, `fix/…`, `docs/…`. Nigdy push bezpośrednio na `main`. PR musi przejść workflow „Verify The Sentenced”.
8. **Nie wdrażasz na Raspberry Pi.** Wdrożenie robi człowiek wg `docs/04-infrastruktura-raspberry.md`. Agent przygotowuje kod + instrukcję + plan rollbacku.
9. Zmiana zachowania widocznego dla graczy → aktualizacja `docs/` w tym samym PR.

## 4. Gdzie szukać odpowiedzi
| Pytanie | Plik |
|---|---|
| Jak jest zbudowany cały system? | `docs/01-architektura.md` |
| Kanały, role, uprawnienia Discord | `docs/02-discord.md` |
| Moduły bota, env, baza, rekrutacja, wybory | `docs/03-bot.md` |
| Raspberry Pi, systemd, tunel, SSH, deploy, backup | `docs/04-infrastruktura-raspberry.md` |
| Addon: moduły, komendy, synchronizacja z Discordem | `docs/05-addon.md` |
| Jak współpracować (gałęzie, PR, review, wydania) | `docs/06-wspolpraca.md` |
| Skąd się wzięło repo, scalanie z `sentencedbot-rekrutacja` | `docs/07-historia-i-scalenie.md` |
| Znane problemy i odpowiedzi na typowe pytania | `docs/FAQ.md` |

## 5. Jak pracować jako agent — procedura
1. Przeczytaj ten plik + właściwy plik z `docs/`.
2. `make test` przed zmianą (zapisz wynik bazowy).
3. Zmień minimalny zakres. Dodaj/zmień test.
4. `make test` po zmianie. Wszystko zielone.
5. Opis PR: co, dlaczego, jak przetestowano, wpływ na Discord/Pi, rollback.
6. Jeśli zmiana wymaga wdrożenia na Pi lub zmian na Discordzie — wypisz kroki dla człowieka w sekcji „Wdrożenie” PR.

## 6. Czego NIE wiesz z repo (zapytaj człowieka)
- Aktualny adres/host Raspberry Pi i użytkownik SSH (celowo poza repo).
- Zawartość `.env` na Pi (wartości; nazwy zmiennych są w `docs/03-bot.md`).
- Pliki istniejące tylko na Pi: `deploy-commands.js`, `setup-server.js`, `upgrade-v2.js`, `layout-v4.js`, `release-v0.5.js`, `repair-v0.5.js` (są w `runtime/package.json` → `scripts`, ale nie ma ich w repo).
- Bieżący stan uprawnień Discord — zawsze weryfikuj świeżym raportem (`tools/check_live.py` z archiwum) zamiast zakładać.
