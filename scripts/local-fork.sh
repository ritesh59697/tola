#!/usr/bin/env bash
# Sets up Tola on a local fork of QIE mainnet: real gold feed, real QUSDC, test wallets.
# Start the fork first:
#   anvil --fork-url https://rpc1mainnet.qie.digital --chain-id 31990 --block-time 3
set -euo pipefail
cd "$(dirname "$0")/../contracts"

export RPC="${RPC:-http://127.0.0.1:8545}"
set -a; source .env.example; set +a

# Anvil's well-known test accounts. They only exist on local chains.
MNEMONIC="test test test test test test test test test test test junk"
key() { cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index "$1"; }
addr() { cast wallet address --private-key "$(key "$1")"; }

export DEPLOYER_KEY="$(key 0)" JEWELLER_KEY="$(key 1)"
JEWELLER="$(addr 1)"; CUSTOMER="$(addr 2)"; SECOND_CUSTOMER="$(addr 3)"

forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast --slow --silent
export REGISTRY="$(python3 -c "import json;print(json.load(open('deployments/31990.json'))['registry'])")"
echo "registry $REGISTRY"

# Finds which storage slot holds QUSDC balances, then gives the test wallets some.
DECIMALS="$(cast call --rpc-url "$RPC" "$STABLECOIN" 'decimals()(uint8)')"
AMOUNT="$(python3 -c "print(1000 * 10 ** $DECIMALS)")"
SLOT=""
for i in $(seq 0 20); do
  probe="$(cast index address "$JEWELLER" "$i")"
  cast rpc --rpc-url "$RPC" anvil_setStorageAt "$STABLECOIN" "$probe" "$(cast to-uint256 "$AMOUNT")" >/dev/null
  if [ "$(cast call --rpc-url "$RPC" "$STABLECOIN" 'balanceOf(address)(uint256)' "$JEWELLER" | cut -d' ' -f1)" = "$AMOUNT" ]; then SLOT="$i"; break; fi
  cast rpc --rpc-url "$RPC" anvil_setStorageAt "$STABLECOIN" "$probe" "$(cast to-uint256 0)" >/dev/null
done
[ -n "$SLOT" ] || { echo "balance slot not found"; exit 1; }
for who in "$CUSTOMER" "$SECOND_CUSTOMER"; do
  cast rpc --rpc-url "$RPC" anvil_setStorageAt "$STABLECOIN" "$(cast index address "$who" "$SLOT")" "$(cast to-uint256 "$AMOUNT")" >/dev/null
done

forge script script/OpenScheme.s.sol --rpc-url "$RPC" --broadcast --slow --silent
SCHEME="$(cast call --rpc-url "$RPC" "$REGISTRY" 'schemesOf(address)(address[])' "$JEWELLER" | tr -d '[]' | awk -F', ' '{print $NF}')"

# The opening bond covers exactly one instalment's requirement: (bond % + bonus %) of one instalment.
INSTALMENT="$(python3 -c "print($SCHEME_INSTALMENT_CENTS * 10 ** $DECIMALS // 100)")"
BOND="$(python3 -c "print($INSTALMENT * ($SCHEME_BOND_BPS + $SCHEME_BONUS_BPS) // 10000)")"
cast send --rpc-url "$RPC" --private-key "$JEWELLER_KEY" "$STABLECOIN" 'approve(address,uint256)' "$SCHEME" "$BOND" >/dev/null
cast send --rpc-url "$RPC" --private-key "$JEWELLER_KEY" "$SCHEME" 'depositBond(uint256)' "$BOND" >/dev/null

echo "scheme   $SCHEME"
echo "jeweller $JEWELLER"
echo "customer $CUSTOMER"
