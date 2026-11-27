# The Sentenced — jedno wejście do testów i buildów całego monorepo.
# Odpowiada 1:1 krokom z .github/workflows/verify.yml.
.PHONY: setup test test-bot test-addon build-addon

setup:
	npm ci --prefix runtime --no-audit --no-fund
	python3 -m pip install --user fonttools

test: test-bot test-addon

test-bot:
	NODE_PATH="$(CURDIR)/runtime/node_modules" node --test tests/*.test.cjs
	python3 -m unittest discover -s tests -p 'test_*.py'

test-addon:
	cd addon && for t in tests/*.lua; do luajit "$$t" || exit 1; done
	cd addon && for s in TheSentenced/*.lua; do luac5.1 -p "$$s" || exit 1; done
	cd addon && python3 tests/verify_assets.py && python3 tests/verify_catalog.py

build-addon:
	cd addon && python3 build.py /tmp/TheSentenced.zip && python3 -m zipfile -t /tmp/TheSentenced.zip
