# 02 — Konfiguracja serwera Discord The Sentenced

> Źródło ID: `runtime/guild-channel-ids.cjs`. Jeśli ID tutaj i w kodzie się różnią — **wygrywa kod**, popraw ten plik.

## Serwer
- **Guild ID:** `1549146537802600568`
- Bot działa tylko na tym serwerze: `channelId(guild, key)` zwraca `undefined` dla innego `guild.id`.
- Włączony natywny **Discord Screening** (Membership Screening) — bot sprawdza `pending === false` (`SCREENING_NOT_VERIFIED`).

## Kanały (nazwa logiczna → ID)
Nazwa logiczna jest stała w kodzie. Nazwa wyświetlana na Discordzie może być inna (patrz kolumna „wyświetlana”).

| Klucz w kodzie | ID | Wyświetlana / przeznaczenie |
|---|---|---|
| `regulamin` | 1573040361251672064 | regulamin (dawniej `rules`) — akceptacja regulaminu |
| `start` | 1549398541149933683 | kreator wniosku rekrutacyjnego |
| `poczekalnia` | 1549398553313677355 | dziś wyświetlana jako `rekrutacja` — oczekujący kandydaci |
| `oficerka` | 1549398574528339968 | KADRA → karty wniosków, decyzje |
| `ogólny` | 1549398546896388276 | czat ogólny |
| `offtop` | 1549398548494422086 | offtop |
| `ogłoszenia-bota` | 1549398543360462868 | ogłoszenia bota |
| `stan-gildii` | 1549398573009862727 | stan gildii (tabele) |
| `historia-gildii` | 1553470706514395319 | historia gildii |
| `czat-wow` | 1568577268056596540 | czat gildii z gry |
| `forever-news` | 1551660125935243426 | newsy WoW Forever (watcher) |
| `addony` | 1568654994054451413 | dziś `addon-the-sentenced` — ogłoszenia addonu |
| `opowiedz_cos_o_sobie` | 1573062971100364942 | przedstaw się |
| `materiały-promocyjne` | 1574150899331244066 | materiały promocyjne |
| `wybory` | 1574129359604813844 | wybory gildyjne |
| `raid-ogłoszenia` | 1574411709819523132 | ogłoszenia raidów |
| `kalendarz` | 1549398556723384350 | kalendarz |
| `zapisy` | 1549398558380269649 | zapisy na raidy |
| `wyprawy` | 1550939366698782811 | wyprawy (eventy) |

### Kanały klasowe
| Klasa | ID |
|---|---|
| Druid | 1575532785962065950 |
| Czarnoksiężnik | 1575532799115399318 |
| Kapłan | 1575532794891997426 |
| Łotrzyk | 1575532796280049786 |
| Łowca | 1575532787476471909 |
| Mag | 1575532789036622024 |
| Paladyn | 1575532790433321034 |
| Szaman | 1575532797777412156 |
| Wojownik | 1575532800843583488 |

### Kanały, na które pisze panel Kadra z addonu (`STAFF_POST_CHANNELS`)
`general → ogólny`, `calendar → kalendarz`, `expeditions → wyprawy`, `addons → addony`.

## Role
| Rola | Kto | Co daje |
|---|---|---|
| `@everyone` | każdy | **brak** podglądu kanałów gildii (ViewChannel zabroniony) |
| `Oczekujący` | kandydat po akceptacji regulaminu | widzi `#start`/`#poczekalnia` (rekrutacja); Member ma tam wprost zablokowany podgląd |
| `Member` | przyjęty członek | ViewChannel + pisanie + historia na kanałach gildii |
| `Dostęp_zatwierdzony` | przyjęty członek (nadawana razem z Member) | znacznik zakończonej rekrutacji; także daje widoczność kanałów |
| `Raid Lider` | prowadzący raidy | raidy/zapisy |
| `Oficer` | kadra | `#oficerka`, decyzje rekrutacyjne, panel Kadra |
| `GM` | Guild Master | wszystko co Oficer + zarządzanie |

Kolejność ról ma znaczenie: rola bota musi być **wyżej** niż `Oczekujący`, `Member`, `Dostęp_zatwierdzony` i role klasowe, inaczej nadawanie ról kończy się 403 (Missing Permissions).

## Ścieżka nowej osoby (stan docelowy)
1. Wejście → natywny Screening Discorda.
2. `#regulamin` → przycisk akceptacji (12 punktów, treść: `runtime/ts-onboarding-v6/content/regulamin.md`). Bot zapisuje datę + skrót SHA-256 wersji, nadaje `Oczekujący`, wskazuje `#start`.
3. `#start` → kreator (szczegóły w `03-bot.md`).
4. Wniosek → karta w `#oficerka`; kandydat czeka w `#poczekalnia` (wyświetlana `rekrutacja`).
5. GM/Oficer akceptuje → `Member` + `Dostęp_zatwierdzony`, zdjęcie `Oczekujący`, powitanie. Odmowa → zostają uprawnienia kandydata, DM jeśli dozwolony.

## Model uprawnień — zasady
- Domyślnie `@everyone` nie widzi nic poza wejściem.
- **Każdy kanał gildii musi mieć nadpisanie dla `Member` z `ViewChannel` (1024) = Allow** oraz Send Messages + Read Message History.
- Nie polegaj na tym, że kadra coś widzi — Oficer/GM/Raid Lider mają własne nadpisania, więc błędy w `Member` są niewidoczne dla kadry. Testuj kontem z samą rolą `Member` (lub „Wyświetl serwer jako rola”).

## Incydent 2026-11-23 (do zapamiętania)
Po przestawieniu kanałów `Member` stracił `ViewChannel` na 8 kanałach: `ogólny`, `offtop`, `nicki-i-battletag`, `guild-czat-z-gry`, `przedstaw-się`, `nowi-w-szeregach`, `kalendarz`, `zapisy` (allow `67584`/`2147551232`/`2147549184` — bez bitu 1024). Do tego bot szukał starych nazw (`rules`, `poczekalnia`, `addony`) i przerywał po akceptacji regulaminu („Nie można kontynuować”). Naprawa: skrypt `fix_perms.py` (dry-run → `--apply` z backupem → `--rollback`), który dodaje tylko bit 1024 dla `Member`. Wniosek na przyszłość: przemianowanie/przesunięcie kanału = sprawdzenie ACL `Member` + kod używa tylko ID.

## Checklista po każdej zmianie na serwerze
- [ ] „Wyświetl serwer jako rola” → `Member`: widać ogólny, offtop, kalendarz, zapisy, przedstaw się, czat z gry.
- [ ] Jako `Oczekujący`: widać tylko regulamin/start/poczekalnię.
- [ ] Rola bota nad rolami, które nadaje.
- [ ] Nowy kanał, którego bot ma używać → dopisany do `runtime/guild-channel-ids.cjs` + tutaj.
