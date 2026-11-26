# Współtworzenie The Sentenced / Contributing

1. Otwórz issue z wersją gry i dodatku, krokami do odtworzenia oraz oczekiwanym wynikiem. Prywatne dane graczy zasłoń na zrzutach.
2. Zrób fork lub utwórz własną gałąź i wprowadź jedną spójną zmianę. Kod funkcji znajdziesz w `addon/TheSentenced`, a testy w `addon/tests`.
3. Uruchom odpowiednie testy. Do sprawdzenia interfejsu skopiuj katalog `addon/TheSentenced` do lokalnego `Interface/AddOns` i użyj `/reload`.
4. Otwórz pull request z wynikiem testów i zrzutem, jeśli zmienia się UI. Opisz, jak sprawdzić poprawkę.

## Testy dodatku

Wymagane są LuaJIT i Python 3 z `fonttools`. Kontrola zasobów używa systemowej biblioteki Lua 5.4 lub pakietu `lupa`.

```sh
cd addon
for test in tests/*.lua; do luajit "$test" || exit; done
python3 tests/verify_assets.py
python3 build.py /tmp/TheSentenced-dev.zip
```

Dane testowe trzymaj w fikcyjnych rekordach. Pliki `WTF`, produkcyjna konfiguracja, klucze i eksporty wniosków powinny pozostać lokalne.

## Bot i integracja

Kod bota znajduje się w `runtime`. Testy rekrutacji i synchronizacji można uruchomić z katalogu głównego repozytorium w Node.js 24 lub nowszym.

```sh
node --test tests/recruitment.test.cjs tests/recruitment-public.test.cjs tests/transfer-sync.test.cjs
```

Bot zawiera ustawienia i identyfikatory specyficzne dla serwera The Sentenced. Do własnego środowiska testowego użyj osobnego serwera Discord, własnej konfiguracji i bazy. Nie uruchamiaj skryptów wdrożeniowych ani bota na produkcji w ramach testu.

## English

Open an issue with your client and addon version and the shortest steps to reproduce the bug. Keep each pull request focused. Include your test results and a screenshot for interface changes. Use synthetic fixtures and redact player details from screenshots. You can test addon changes locally without any Discord credentials.
