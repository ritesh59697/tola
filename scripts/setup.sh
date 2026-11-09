#!/usr/bin/env bash
# Installs what's needed to build and test Tola after a fresh clone.
set -euo pipefail
cd "$(dirname "$0")/.."
(cd contracts && forge install --no-git foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.1.0)
(cd app && npm ci)
