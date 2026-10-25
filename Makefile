# SPDX-License-Identifier: GPL-2.0-or-later

UUID := zark@juanmitaboada.com
ZARK_BRAND ?= ../zark/docs/images/brand/zark-symbolic.svg
ZARK_FIXTURES ?= ../zark/tests/fixtures/status

.PHONY: test lint icons fixtures

## test: run the pure-module tests under gjs
test:
	TZ=UTC gjs -m tests/run.js

## lint: ESLint with GNOME's rules (needs `npm install` once)
lint:
	npx eslint .

## icons: rebuild the panel icons from zark's brand mark
icons:
	python3 -I dev/make-icons.py $(ZARK_BRAND) icons

## fixtures: copy the contract's fixtures from a zark checkout
fixtures:
	rm -rf tests/fixtures
	cp -r $(ZARK_FIXTURES) tests/fixtures
