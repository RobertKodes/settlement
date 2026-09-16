# Root entry point. Every human-facing command lives here; targets shell out to pnpm/turbo/forge and chain/scripts/*.sh.
# Requires GNU make >= 3.81 (macOS ships 3.81). Run `make help` for the list.

SHELL := /bin/bash
.DEFAULT_GOAL := help
CHAIN_SCRIPTS := chain/scripts
FORGE ?= $(shell command -v forge 2>/dev/null || echo $(HOME)/.foundry/bin/forge)

.PHONY: help doctor bootstrap install build lint lint-fix typecheck test forge-build forge-test \
        devnet-bootstrap devnet-preflight devnet-up devnet-status devnet-logs devnet-down devnet-reset \
        services-up services-down ledger-migrate adr-new check-name

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

doctor: ## Check local toolchain versions against the minimums
	@bash $(CHAIN_SCRIPTS)/doctor.sh

bootstrap: doctor install devnet-bootstrap ## First-time setup: doctor + deps + forge-std + vendored Lineth

install: ## pnpm install + forge install
	pnpm install
	cd protocol/contracts && $(FORGE) install

build: ## Build every workspace package (turbo)
	pnpm turbo run build

lint: ## Biome check (TS/JSON) + forge fmt --check
	pnpm biome check .
	cd protocol/contracts && $(FORGE) fmt --check

lint-fix: ## Biome write + forge fmt
	pnpm biome check --write .
	cd protocol/contracts && $(FORGE) fmt

typecheck: ## tsc --noEmit across packages
	pnpm turbo run typecheck

test: ## Vitest + forge test across packages
	pnpm turbo run test

forge-build: ## forge build (protocol/contracts)
	cd protocol/contracts && $(FORGE) build

forge-test: ## forge test -vvv (protocol/contracts)
	cd protocol/contracts && $(FORGE) test -vvv

devnet-bootstrap: ## Sparse-clone the pinned Lineth commit into chain/lineth/upstream
	@bash $(CHAIN_SCRIPTS)/bootstrap.sh

devnet-preflight: ## Check Docker memory, compose version, ports, disk before booting
	@bash $(CHAIN_SCRIPTS)/preflight.sh

devnet-up: ## Boot the local Lineth devnet (local L1 + L2 + dev prover)
	@bash $(CHAIN_SCRIPTS)/up.sh

devnet-status: ## Chain IDs, block heights, service state
	@bash $(CHAIN_SCRIPTS)/status.sh

devnet-logs: ## Follow devnet logs (SERVICE=name to filter)
	@bash $(CHAIN_SCRIPTS)/logs.sh $(SERVICE)

devnet-down: ## Stop the devnet, keep volumes
	@bash $(CHAIN_SCRIPTS)/down.sh

devnet-reset: ## Stop the devnet and wipe volumes/artifacts (required after a chain-ID change)
	@bash $(CHAIN_SCRIPTS)/reset.sh

services-up: ## Postgres 16 + Redis 7 for the ledger (infra/docker/compose.services.yml)
	docker compose -f infra/docker/compose.services.yml up -d --wait

services-down: ## Stop Postgres/Redis
	docker compose -f infra/docker/compose.services.yml down

ledger-migrate: ## Apply services/ledger/migrations/*.sql in order
	@bash services/ledger/migrate.sh

adr-new: ## Create the next ADR from the template: make adr-new NAME="short-title"
	@bash docs/adr/new.sh "$(NAME)"

check-name: ## Fail if the dropped working name appears anywhere
	@! grep -rIi --exclude-dir=upstream --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.turbo --exclude-dir=out --exclude-dir=lib "[n]exus" . || (echo "dropped working name found (see above)"; exit 1)
