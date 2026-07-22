.PHONY: bootstrap dev test check build-macos data-validate

bootstrap:
	npm --prefix apps/desktop install

dev:
	npm run dev

test:
	npm test

check:
	npm run check

data-validate:
	npm run data:validate

build-macos:
	npm run build

