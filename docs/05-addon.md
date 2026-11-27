# 05 — Dodatek WoW „The Sentenced Guild Hall”

Wersja **0.6.43-alpha**, klient **WoW Forever 1.60.1**, `## Interface: 16001`. Kod: `addon/TheSentenced/`, opis dla graczy: `addon/README.md`.

## Instalacja (gracz)
1. Pobierz ZIP z [GitHub Releases](https://github.com/damianx9x/The-Sentenced/releases) lub [CurseForge](https://www.curseforge.com/wow/addons/ts-guild-hall).
2. Rozpakuj do `Interface/AddOns` → musi powstać `Interface/AddOns/TheSentenced/TheSentenced.toc`.
3. W grze: `/ts` lub ikona przy minimapie (herb gildii).

## Komendy
| Komenda | Działanie |
|---|---|
| `/ts` | otwiera Guild Hall |
| `/tssnake` | minigra Snake |
| `/tssnake auto` | włącza/wyłącza automatyczne otwieranie Snake podczas długiego lotu |
| `/reload` | zapisuje SavedVariables (konieczne do wymiany danych z mostem) |

## Funkcje
- **Gildia → Ludzie gildii:** roster, publiczne notatki, wyszukiwanie po nicku/klasie/randze, filtr poziomu (`40`, `40-50`, `>=55`), profile.
- **Ustawienia → Postać → Zapisz profesje w notatce gildii:** natywny edytor z profesjami; ostrzega przed nadpisaniem notatki.
- **Moja oś łupów:** dziennik zielonych i lepszych łupów (do 100 lokalnych wpisów na postać), mapa zbieractwa.
- **Rzemiosło / Zasoby:** wyszukiwarka profesji i dobrowolnie udostępnionych zasobów (bez banku i poczty).
- **Przed wyprawą:** checklista gotowości; do gildii idzie tylko status (wygasa po 2 h).
- **Wyprawy i tabela:** formularze wydarzeń, kalendarz gry, zapisy TAK/MOŻE/NIE.
- **Discord:** parowanie postaci, podgląd raidów i wypraw, zapisy.
- **Kadra (GM/Oficer):** wnioski rekrutacyjne, decyzje, wpisy na wybrane kanały Discord (podpis „Kadra The Sentenced”).
- **Snake:** 4 trasy, labirynty, bonusy, tekstura `Textures/SnakeBoard.tga`.

## Moduły (kolejność ładowania wg `TheSentenced.toc`)
| Plik | Rola |
|---|---|
| `Core.lua` (~200 KB) | szkielet UI, zakładki, routing, SavedVariables |
| `Localization.lua`, `Theme.lua`, `Fonts/`, `Textures/` | teksty PL/EN, styl, czcionki (Cinzel, DejaVuSans — licencje w `Fonts/`) |
| `Wire.lua` | format wymiany danych (żądania/odpowiedzi do bota, kopiuj-wklej) |
| `GuildAccess.lua` | kto jest kadrą (GM/Oficer) w grze |
| `Profiles.lua`, `RosterCapture.lua`, `RosterSearch.lua`, `MemberPicker.lua` | profile, zrzut rosteru, wyszukiwanie |
| `NativeProfessions.lua`, `CraftDirectory.lua`, `ResourceDirectory.lua`, `QuestItems.lua` | profesje, rzemiosło, zasoby |
| `EventPicker.lua`, `InstancePicker.lua`, `EventSync.lua`, `EventRetry.lua`, `EventNotifications.lua`, `GameCalendar.lua`, `Raids.lua`, `Ready.lua` | wydarzenia, raidy, kalendarz, gotowość |
| `LootJournal.lua`, `Gather.lua`, `MapPins.lua`, `BoardItems.lua` | łupy, zbieractwo, pinezki mapy |
| `TransferSync.lua`, `CompanionSnapshot.lua`, `Archive.lua` | wymiana danych z botem/mostem, archiwum |
| `GuildLinks.lua`, `GuildWelcome.lua` | linki, powitanie w gildii |
| `Diagnostics.lua`, `TestCleanup.lua` | diagnostyka, sprzątanie danych testowych |
| `Snake.lua`, `SnakeUI.lua` | minigra |

## Jak addon rozmawia z botem
Addon **nie ma dostępu do sieci**. Dwie drogi:
1. **Most Mac (automatycznie):** `mac/roster_sync.py` co 15 s. `/reload` zapisuje decyzje do kolejki i wczytuje najnowszą migawkę od bota. Bot ↔ most: `runtime/companion-api.cjs`, `device-api.cjs`, `transfer-sync.cjs`, `roster/receive.cjs`.
2. **Ręcznie (dowolny gracz):** Discord `/bot → Addon → Połącz addon` → wpisz jednorazowy kod w grze → skopiuj żądanie z gry do `/bot → Addon → Synchronizacja dodatku` → wklej odpowiedź bota do addonu. Zmiana zapisu na raid działa dopiero po wysłaniu żądania; addon pokazuje tylko stan potwierdzony przez bota.

## Rozwój
- Test w grze: skopiuj `addon/TheSentenced` do lokalnego `Interface/AddOns`, `/reload`.
- Testy offline: `make test-addon` (mock WoW API: `addon/tests/mock.lua`).
- Build: `make build-addon` → `/tmp/TheSentenced.zip`.
- Wydanie: podbij `## Version` w `.toc` i nagłówek `addon/README.md`, zbuduj ZIP, GitHub Release + upload na CurseForge.
- Nie commituj `WTF/`, SavedVariables, eksportów wniosków.
