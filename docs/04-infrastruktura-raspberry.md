# 04 — Infrastruktura: Raspberry Pi, tunel, wdrożenie

> Repo jest publiczne. Adresy, użytkownicy, ID tunelu i hasła są **celowo** zastąpione placeholderami `<…>`. Prawdziwe wartości zna administrator (Damian / @icex). Nie dopisuj ich tutaj.

## Host
- **Raspberry Pi** w sieci domowej administratora (Linux, systemd). Na tym samym Pi działają też inne, niezwiązane usługi — **nie restartuj niczego poza `sentencedbot.service`**, nie zmieniaj limitów CPU/RAM i nie reorganizuj cgroup.
- Bot: usługa systemd **`sentencedbot.service`** (active/enabled, autostart po reboocie).
- Katalog bota: `<katalog-bota>` (zawiera `index.js`, `node_modules`, `.env`, plik(i) `*.db` SQLite).
- Dostęp administracyjny: SSH z Maca w tej samej sieci: `ssh <user>@<adres-pi>` (klucz SSH, bez hasła w skryptach).

## Tunel / dostęp z zewnątrz
- Na Pi działa **Cloudflare Tunnel (`cloudflared`)** jako usługa systemd + **nginx** jako reverse proxy dla usług HTTP wystawianych na świat. Usługi aplikacyjne słuchają na `127.0.0.1:<port>` (loopback), a na zewnątrz wychodzą wyłącznie przez tunel — bez otwierania portów na routerze.
- Bot Discord **nie potrzebuje** tunelu: łączy się wychodząco do Discord Gateway.
- Most Mac ↔ bot (`mac/roster_sync.py` ↔ `companion-api`/`device-api`) działa w LAN; jeśli kiedyś ma działać spoza domu — przez nową trasę w istniejącym tunelu Cloudflare (hostname → `http://127.0.0.1:<port>`), z uwierzytelnieniem po stronie API. **Nie stawiaj drugiego tunelu** ani nie wystawiaj portu bezpośrednio.
- Konfiguracja tunelu (`/etc/cloudflared/config.yml` lub `~/.cloudflared/`, `credentials.json`, `cert.pem`) zostaje na Pi. Nigdy w repo.

### Dodanie trasy w tunelu (procedura dla admina)
```sh
ssh <user>@<adres-pi>
sudo cat /etc/cloudflared/config.yml          # sprawdź istniejące ingress
# dopisz PRZED regułą końcową http_status:404:
#   - hostname: <nowa-nazwa>.<domena>
#     service: http://127.0.0.1:<port>
cloudflared tunnel ingress validate
sudo systemctl restart cloudflared
cloudflared tunnel route dns <nazwa-tunelu> <nowa-nazwa>.<domena>
curl -sI https://<nowa-nazwa>.<domena>/        # weryfikacja
```

## Operacje na bocie
```sh
ssh <user>@<adres-pi>
systemctl status sentencedbot.service          # stan (może wymagać --user, sprawdź `systemctl --user status` jeśli nie znaleziono)
journalctl -u sentencedbot.service -n 200 -f   # logi
sudo systemctl restart sentencedbot.service    # restart (tylko ta usługa!)
```
Podgląd bazy tylko do odczytu:
```sh
ssh <user>@<adres-pi> 'cd <katalog-bota> && sqlite3 -readonly *.db ".schema"'
```

## Wdrożenie nowej wersji (procedura)
1. PR zmergowany do `main`, CI zielone.
2. **Backup** na Pi:
   ```sh
   ssh <user>@<adres-pi> 'cd <katalog-bota> && ts=$(date +%Y%m%d-%H%M) && mkdir -p ~/backups/sentencedbot-$ts && cp -a *.js *.cjs package*.json ts-onboarding-v6 election recruitment roster ~/backups/sentencedbot-$ts/ 2>/dev/null; sqlite3 *.db ".backup ~/backups/sentencedbot-$ts/bot.db"'
   ```
3. Skopiuj `runtime/` z repo do `<katalog-bota>` (bez `.env`, bez `*.db`, bez `node_modules`):
   ```sh
   rsync -av --exclude .env --exclude '*.db' --exclude node_modules runtime/ <user>@<adres-pi>:<katalog-bota>/
   ssh <user>@<adres-pi> 'cd <katalog-bota> && npm ci --omit=dev'
   ```
4. Jeśli zmieniły się komendy slash: `npm run deploy` na Pi (`deploy-commands.js` istnieje tylko na Pi).
5. `sudo systemctl restart sentencedbot.service` → `journalctl … -f` → test na Discordzie kontem z samą rolą `Member` oraz ścieżką kandydata.
6. **Rollback:** przywróć pliki z `~/backups/sentencedbot-<ts>/`, ewentualnie bazę (`bot.db`) — uwaga: utracisz wnioski złożone po backupie; restart usługi.

> Historyczne narzędzia wdrożeniowe (patche na kod Pi z sumami `base.sha256`, `release/stage_pi.py`, `deploy_pi.py`, `tools/check_live.py`, `acl_preview.py`) są w archiwum `legacy/rekrutacja/` po scaleniu (patrz `07-historia-i-scalenie.md`). Model „patch na kod z Pi” jest zastąpiony modelem „repo = kod”.

## Mac oficera
- macOS, klient WoW Forever, `mac/roster_sync.py` uruchamiany cyklicznie co 15 s (np. launchd). Czyta/zapisuje SavedVariables addonu w `…/WTF/Account/<KONTO>/SavedVariables/TheSentenced.lua` i rozmawia z botem po LAN.
- Mac ma SSH do Pi — dlatego **nie podłączaj agentów AI z dostępem do shella na tym Macu** bez bramki zatwierdzania poleceń.

## Sekrety — gdzie są
| Sekret | Lokalizacja |
|---|---|
| Token bota Discord | `.env` na Pi |
| Poświadczenia cloudflared | `/etc/cloudflared/` lub `~/.cloudflared/` na Pi |
| Klucz SSH do Pi | `~/.ssh/` na Macu admina |
| Baza SQLite (dane graczy) | `<katalog-bota>/*.db` na Pi + backupy |
