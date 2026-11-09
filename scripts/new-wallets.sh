#!/usr/bin/env bash
# Creates fresh wallets for Tola's mainnet demo and saves them to contracts/.env, which git ignores.
# Never put a wallet holding real savings here. Keep only what the demo needs.
set -euo pipefail
cd "$(dirname "$0")/../contracts"

if [ -f .env ]; then
  echo "contracts/.env already exists. Not overwriting it, because that could lose the keys in it."
  exit 1
fi

cp .env.example .env
for name in DEPLOYER JEWELLER CUSTOMER; do
  key="$(cast wallet new --json | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['private_key'])")"
  sed -i '' "s|^${name}_KEY=.*|${name}_KEY=${key}|" .env
done
chmod 600 .env

deployer="$(cast wallet address --private-key "$(grep ^DEPLOYER_KEY= .env | cut -d= -f2)")"
echo
echo "Send QIE on QIE Mainnet (chain 1990) to this address:"
echo "  $deployer"
echo
echo "The next script shares it out and swaps what the demo needs into QUSDC."
