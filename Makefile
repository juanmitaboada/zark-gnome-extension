# SPDX-License-Identifier: GPL-2.0-or-later

UUID := zark@juanmitaboada.com
ZARK_BRAND ?= ../zark/docs/images/brand/zark-symbolic.svg
ZARK_FIXTURES ?= ../zark/tests/fixtures/status

.PHONY: test lint icons fixtures pack

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

## pack: the zip for extensions.gnome.org (dev/, tests/ and debian/ stay out)
# Packs the committed tree, not the working copy, with every entry dated at
# the commit, so the same commit always gives the same zip.
PACK_DIR := build/pack
pack:
	rm -rf $(PACK_DIR)
	mkdir -p $(PACK_DIR)
	git archive HEAD | tar -x -C $(PACK_DIR)
	gnome-extensions pack --force --extra-source=lib --extra-source=icons --out-dir=$(CURDIR) $(PACK_DIR)
	python3 -I dev/zip-dates.py $(UUID).shell-extension.zip $$(git log -1 --format=%ct)
	rm -rf build
