# Include environment variables
-include .env

.PHONY: all clean compile build test test-invariant slither deploy-local deploy-base git-sync

# Default target
all: clean compile build test

# Development & Compilation
clean:
	@forge clean

compile:
	@forge compile

build:
	@forge build

# Testing & Static Analysis
test:
	@forge test -vvv

test-invariant:
	@forge test --match-contract InvariantProtocol -vvv

slither:
	@slither . --solc-remaps '@openzeppelin/=lib/openzeppelin-contracts/ @chainlink/=lib/chainlink-brownie-contracts/' --filter-paths "lib/|test/|script/" --checklist

# Deployment Routes
deploy-local:
	@forge script script/Deploy.s.sol:DeployScript --rpc-url http://127.0.0.1:8545 --private-key $(PRIVATE_KEY) --broadcast -vvvv

deploy-base:
	@forge script script/Deploy.s.sol:DeployScript --rpc-url $(BASE_MAINNET_URL) --private-key $(PRIVATE_KEY) --broadcast --verify --verifier sourcify -vvvv

# Repository Sync
git-sync:
	@git add . && git commit -m "chore: protocol updates and repository sync" && git push -u origin main --force