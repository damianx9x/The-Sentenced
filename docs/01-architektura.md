# 01 — Architektura systemu The Sentenced

## W skrócie
Gildia **The Sentenced** gra w **World of Warcraft: Forever** (klient 1.60.1, interfejs `16001`). Wokół gildii działają trzy programy, które wymieniają dane:

```
┌──────────────────────┐   discord.js 14 / Gateway + REST   ┌────────────────────────┐
│  Serwer Discord       │ <─────────────────────────────────> │  SentencedBot (Node)    │
│  The Sentenced        │                                     │  runtime/index.js       │
│  (kanały, role, ACL)  │                                     │  SQLite (better-sqlite3)│
└──────────────────────┘                                     │  Raspberry Pi, systemd  │
                                                             │  sentencedbot.service   │
                                                             └──────────┬─────────────┘
                                                                        │ HTTP (companion-api / device-api)
                                                                        │ przez SSH/LAN lub tunel Cloudflare
                                                             ┌──────────┴─────────────┐
                                                             │  Mac oficera            │
                                                             │  mac/roster_sync.py     │
                                                             │  co 15 s                │
                                                             └──────────┬─────────────┘
                                                                        │ pliki SavedVariables (WTF/)
                                                             ┌──────────┴─────────────┐
                                                             │  Klient WoW Forever     │
                                                             │  addon TheSentenced     │
                                                             │  /ts, panel Kadra       │
                                                             └────────────────────────┘
```

## Elementy
| Element | Technologia | Gdzie działa | Kod |
|---|---|---|---|
| Bot SentencedBot 3.0.1 | Node.js 24, discord.js ^14.27, better-sqlite3, dotenv, luxon, cheerio | Raspberry Pi (usługa systemd `sentencedbot.service`) | `runtime/` |
| Dodatek Guild Hall 0.6.43-alpha | Lua 5.1 (WoW API Forever) | Klient gry każdego gracza | `addon/TheSentenced/` |
| Most Mac ↔ bot | Python 3 | Mac oficera z grą (LAN z Pi) | `mac/roster_sync.py` |
| Serwer Discord | Discord | chmura Discord | konfiguracja: `docs/02-discord.md`, ID: `runtime/guild-channel-ids.cjs` |
| Strona | — | https://thesentenced.pl/ | poza repo |
| Dystrybucja addonu | CurseForge `ts-guild-hall` + GitHub Releases | — | `addon/build.py` |

## Przepływy danych
1. **Rekrutacja (Discord → bot → kadra):** nowa osoba → `#regulamin` (akceptacja, hash wersji) → kreator w `#start` (TAK = stary członek / NIE = nowy) → karta wniosku w `#oficerka` → decyzja GM/Oficera → bot nadaje `Member` + `Dostęp_zatwierdzony`, zdejmuje `Oczekujący`, wita. Szczegóły: `03-bot.md#rekrutacja`.
2. **Roster gry → Discord:** addon zapisuje roster/profil do SavedVariables → `mac/roster_sync.py` wysyła do bota (`runtime/roster/receive.cjs`, `import.cjs`) → bot aktualizuje tabele gildii (`guild-tables.cjs`) i kanały (`stan-gildii`, `historia-gildii`).
3. **Discord → gra (panel Kadra):** bot przygotowuje migawkę (wnioski, raidy, wyprawy) → most zapisuje ją do pliku czytanego przez addon po `/reload` → decyzje z gry wracają kolejką do bota.
4. **Gracz bez Maca:** parowanie ręczne kodem: `/bot → Addon → Połącz addon` na Discordzie ↔ kod w grze ↔ `/bot → Addon → Synchronizacja dodatku` (kopiuj-wklej żądania i odpowiedzi).

## Ograniczenia, o których trzeba wiedzieć
- Addon nie ma sieci — WoW nie pozwala addonom na HTTP. Wszystko idzie przez pliki SavedVariables (zapis tylko przy `/reload` lub wylogowaniu) albo przez kopiuj-wklej.
- Powitanie Discord → czat gildii w grze jest **zablokowane z zewnątrz** (Discord 403, kod 20062; issue discord-api-docs#8628 zamknięte jako „not planned”).
- `runtime/system-version.json`: `gameTransportVerified: false` — transport gra↔bot nie jest uznany za zweryfikowany produkcyjnie.
