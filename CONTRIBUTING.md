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

## Testy bota i mostu

Z katalogu repozytorium, z Node.js 24 i Pythonem 3:

```sh
npm ci --prefix runtime --no-audit --no-fund
NODE_PATH="$PWD/runtime/node_modules" node --test tests/*.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

Workflow **Verify The Sentenced** uruchamia te testy oraz kontrolę składni Lua 5.1, zasobów i ZIP-a. Próby nie potrzebują logowania do WoW ani Discorda.

## English

Open an issue with your client and addon version and the shortest steps to reproduce the bug. Keep each pull request focused. Include your test results and a screenshot for interface changes. Use synthetic fixtures and redact player details from screenshots. You can test addon changes locally without any Discord credentials.
