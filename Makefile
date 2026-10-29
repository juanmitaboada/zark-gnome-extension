# SPDX-License-Identifier: GPL-2.0-or-later

UUID := zark@juanmitaboada.com
ZARK_BRAND ?= ../zark/docs/images/brand/zark-symbolic.svg
ZARK_FIXTURES ?= ../zark/tests/fixtures/status

.PHONY: test lint icons fixtures pack check-pack

## test: run the pure-module tests under gjs
test:
	TZ=UTC gjs -m tests/run.js

## lint: ESLint with GNOME's rules (needs `npm ci` once: the versions in package-lock.json)
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
# Packs the committed tree, not the working copy; dev/zip-dates.py sorts the
# entries, dates them at the commit in UTC and sets their modes, so the same
# commit gives the same bytes whatever the machine's umask or time zone.
PACK_DIR := build/pack
pack:
	rm -rf $(PACK_DIR)
	mkdir -p $(PACK_DIR)
	git archive HEAD | tar -x -C $(PACK_DIR)
	gnome-extensions pack --force --extra-source=lib --extra-source=icons --out-dir=$(CURDIR) $(PACK_DIR)
	python3 -I dev/zip-dates.py $(UUID).shell-extension.zip $$(git log -1 --format=%ct)
	rm -rf build

## check-pack: the zip holds the extension's files and nothing else (after pack)
check-pack:
	python3 -I dev/check-pack.py $(UUID).shell-extension.zip

# Debian package (PPA)
# Modelled on zark's: the .orig is the tracked tree without debian/, the
# binary is built from the source package as Launchpad gets it, and what
# goes to the PPA is exactly a signed tag.

PKG := gnome-shell-extension-zark
VERSION := $(shell python3 -I -c "import json; print(json.load(open('metadata.json'))['version-name'])")
# Rebuilt by every deb and deb-ppa: the same commit gives the same bytes
# (git archive's times are the commit's, gzip -n stores none).
ORIG_TARBALL := ../$(PKG)_$(VERSION).orig.tar.gz
# Series and Ubuntu release, while shell-version is ["50"].
PPA_TABLE := resolute:26.04
PPA_DPUT_TGT := zark-ppa
# Every series entry is a rebuild of the tree's own entry for its series.
LINTIAN_SUPPRESS_TAGS := bad-distribution-in-changes-file
# The date of the series entries (RFC 2822, as `date -R` prints it); empty
# leaves dch's own.
CHANGELOG_DATE ?=
# The upload command; DPUT=true builds and signs every series without
# uploading (a check on carmen that the tree comes back clean).
DPUT ?= dput

.PHONY: dist deb release-guard deb-ppa

## dist: the upstream tarball, tracked files without debian/ and .github/, at the commit's time
dist:
	git archive --format=tar --prefix=$(PKG)-$(VERSION)/ HEAD -- . ':(exclude)debian' ':(exclude).github' | gzip -n > $(ORIG_TARBALL)
	@echo "  $(ORIG_TARBALL)"

## deb: the unsigned .deb, built from the source package, with lintian on both
deb: dist
	@command -v debuild >/dev/null || { echo "  debuild not installed: sudo apt install devscripts debhelper"; exit 1; }
	@set -e; tmp=$$(mktemp -d); trap 'rm -rf "$$tmp"' EXIT INT TERM; \
	cp $(ORIG_TARBALL) "$$tmp/"; \
	mkdir "$$tmp/src"; \
	tar -xzf $(ORIG_TARBALL) -C "$$tmp/src" --strip-components=1; \
	git ls-files -z debian | tar --null -T - -cf - | tar -xf - -C "$$tmp/src"; \
	(cd "$$tmp/src" && dpkg-source -b .); \
	dpkg-source -x "$$tmp"/$(PKG)_$(VERSION)-*.dsc "$$tmp/build"; \
	(cd "$$tmp/build" && debuild -us -uc -b --lintian-opts --suppress-tags $(LINTIAN_SUPPRESS_TAGS)); \
	lintian --suppress-tags $(LINTIAN_SUPPRESS_TAGS) "$$tmp"/$(PKG)_$(VERSION)-*.dsc; \
	cp "$$tmp"/$(PKG)_$(VERSION)-*_all.deb ..
	@echo "  Built: $$(ls -1t ../$(PKG)_$(VERSION)-*_all.deb | head -1)"

## release-guard: refuse a tree that is dirty, not at a signed tag v$(VERSION), or whose changelog is not this version's
release-guard:
	@test -z "$$(git status --porcelain)" || { echo "  The tree has uncommitted or untracked files"; git status --short; exit 1; }
	@test "$$(git describe --exact-match --tags HEAD 2>/dev/null)" = "v$(VERSION)" || { echo "  HEAD is not the tag v$(VERSION)"; exit 1; }
	@git verify-tag "v$(VERSION)" >/dev/null 2>&1 || { echo "  The tag v$(VERSION) has no valid signature: git tag -s"; exit 1; }
	@head -1 debian/changelog | grep -qv ' UNRELEASED;' || { echo "  debian/changelog's top entry is UNRELEASED"; exit 1; }
	@top=$$(head -1 debian/changelog | sed -nE 's/^[^ ]+ \(([^)]+)\).*/\1/p'); \
	test "$${top%-*}" = "$(VERSION)" || { echo "  debian/changelog's top entry is $$top, not $(VERSION)-<revision>"; exit 1; }

## deb-ppa: a signed source package per series, uploaded to the PPA (from the signed tag only)
deb-ppa: release-guard dist
	@command -v $(DPUT) >/dev/null || { echo "  $(DPUT) not installed: sudo apt install dput-ng"; exit 1; }
	$(eval GPG_KEYID := $(shell gpg --list-secret-keys --with-colons juanmi@juanmitaboada.com 2>/dev/null | awk -F: 'BEGIN{want=0;u="";v=""} $$1=="sec" {want=($$2=="u")?1:(($$2=="-")?2:0); next} $$1=="fpr" && want==1 && !u {u=$$10} $$1=="fpr" && want==2 && !v {v=$$10} END{print (u ? u : v)}'))
	@test -n "$(GPG_KEYID)" || { echo "  No usable GPG secret key for juanmi@juanmitaboada.com"; exit 1; }
	@echo "  This builds and uploads $(PKG) $(VERSION) for: $(PPA_TABLE) to $(PPA_DPUT_TGT) with $(DPUT)."
	@read -r -p "  Continue? [y/N] " ans && [ "$$ans" = "y" ] || { echo "  Aborted."; exit 1; }
	@# The changelog backup lives outside the tree: dh_clean deletes *.bak.
	@set -e; \
	backup=$$(mktemp -t $(PKG)-changelog-XXXXXX); \
	cp debian/changelog "$$backup"; \
	trap 'cp -f "$$backup" debian/changelog 2>/dev/null || true; rm -f "$$backup" debian/files' EXIT INT TERM; \
	for entry in $(PPA_TABLE); do \
		series="$${entry%%:*}"; release="$${entry#*:}"; \
		version="$(VERSION)-1~ubuntu$$release.1"; \
		echo ""; echo "  -- $$series ($$version) --"; \
		cp "$$backup" debian/changelog; \
		DEBEMAIL="juanmi@juanmitaboada.com" DEBFULLNAME="Juanmi Taboada" \
		    dch --newversion "$$version" --distribution "$$series" \
		        --force-distribution --force-bad-version "Build for Ubuntu $$series."; \
		if [ -n "$(CHANGELOG_DATE)" ]; then \
		    sed -i '0,/^ -- /s/^\( -- .*>  \).*/\1$(CHANGELOG_DATE)/' debian/changelog; \
		fi; \
		head -6 debian/changelog; \
		debuild -S -sa -us -uc --lintian-opts --suppress-tags $(LINTIAN_SUPPRESS_TAGS); \
		rm -f debian/files; \
		debsign -k$(GPG_KEYID) "../$(PKG)_$${version}_source.changes"; \
		head -1 "../$(PKG)_$${version}_source.changes" | grep -q "BEGIN PGP SIGNED MESSAGE" \
		    || { echo "  ERROR: the .changes is not signed"; exit 1; }; \
		rm -f "../$(PKG)_$${version}_source.$(PPA_DPUT_TGT).upload"; \
		$(DPUT) -c dput.cf $(PPA_DPUT_TGT) "../$(PKG)_$${version}_source.changes"; \
	done
