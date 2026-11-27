# 07 — Historia i scalenie z `sentencedbot-rekrutacja`

## Dwa repozytoria → jedno
| Repo | Widoczność | Co zawierało | Stan |
|---|---|---|---|
| `damianx9x/The-Sentenced` | publiczne | addon, pełny kod bota (`runtime/`), most Mac, testy, CI | **repo główne (to)** |
| `damianx9x/sentencedbot-rekrutacja` | prywatne | model „patch na kod z Pi”: `integration/sentencedbot.patch`, `release/sentencedbot-3.0.patch`, `refresh/3.0.1.patch` z sumami `base.sha256`; narzędzia `release/stage_pi.py`, `deploy_pi.py`, `deploy_worker.py`, `tools/check_live.py`, `acl_preview.py`, `live_snapshot.py`; audyt `docs/AUDYT-2026-11-20.md`; noty `RELEASE-3.0.0/3.0.1`; gałąź `feat/election-foundations-20261122` (74 commity: wybory, tabele gildii, zadania kadry, addon 0.6.28–0.6.30) | archiwum |

Kod funkcjonalny z gałęzi wyborczej (`runtime/election/`, `guild-tables.cjs`, `guild-staff.cjs`) i rekrutacja v6 są już w `runtime/` tego repo. Z prywatnego repo brakuje tu tylko historii, patchy, narzędzi wdrożeniowych i dokumentów audytu.

## Scalenie z pełną historią
Skrypt `scripts/merge-rekrutacja.sh` (uruchom na Macu, potrzebny dostęp do prywatnego repo):
- tworzy gałąź `chore/merge-rekrutacja`,
- dociąga **obie** gałęzie prywatnego repo jako `git subtree` do `legacy/rekrutacja/` (main) i `legacy/rekrutacja-elections/` (gałąź wyborcza) z zachowaniem historii commitów,
- przed pushem uruchamia skan sekretów — **repo docelowe jest publiczne**, więc wszystko, co trafi do `legacy/`, stanie się publiczne.

```sh
git clone git@github.com:damianx9x/The-Sentenced.git && cd The-Sentenced
git checkout docs/monorepo-guide   # albo main po merge tego PR
bash scripts/merge-rekrutacja.sh
# przejrzyj wynik skanu, potem:
git push -u origin chore/merge-rekrutacja
```
Po merge: w `sentencedbot-rekrutacja` dopisz w README „Przeniesione do The-Sentenced/legacy/rekrutacja” i zarchiwizuj repo (Settings → Archive).

## Decyzje
- „Repo = kod” zamiast „patch na kod z Pi” (ryzyko H1 z audytu: pełny kod nie był w repo — rozwiązane przez `runtime/`).
- Wiedza operacyjna (Pi, tunel) przeniesiona z prywatnych notatek administratora do `docs/04-…`, bez wartości wrażliwych.
