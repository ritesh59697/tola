#!/usr/bin/env bash
# Deploys Tola and prepares the public demo, from one funded deployer wallet:
#   1. shares QIE to the jeweller and customer wallets and swaps some into QUSDC on QIEDEX
#   2. deploys the registry, with the price age measured from the real feed's history
#   3. opens a demo plan and a real-months plan
#   4. has a customer join, then makes one real failed attempt to take their money
#   5. saves that transaction as public proof for the site
# Set RPC to a local fork to rehearse the whole thing first.
set -euo pipefail
cd "$(dirname "$0")/../contracts"
set -a; source .env; set +a

RPC="${RPC:-$QIE_MAINNET_RPC}"
DEX_ROUTER="${DEX_ROUTER:-0x08cd2e72e156D8563B4351eb4065C262A9f553Ef}"
QIE_FOR_JEWELLER="${QIE_FOR_JEWELLER:-15}"
QIE_FOR_CUSTOMER="${QIE_FOR_CUSTOMER:-60}"
GAS_RESERVE_QIE="${GAS_RESERVE_QIE:-2}"

DEPLOYER="$(cast wallet address --private-key "$DEPLOYER_KEY")"
JEWELLER="$(cast wallet address --private-key "$JEWELLER_KEY")"
CUSTOMER="$(cast wallet address --private-key "$CUSTOMER_KEY")"
CHAIN_ID="$(cast chain-id --rpc-url "$RPC")"

balance="$(cast balance --rpc-url "$RPC" "$DEPLOYER" --ether)"
need="$(python3 -c "print($QIE_FOR_JEWELLER + $QIE_FOR_CUSTOMER + 1)")"
if ! python3 -c "import sys; sys.exit(0 if $balance >= $need else 1)"; then
  echo "Deployer $DEPLOYER holds $balance QIE and needs at least $need."
  exit 1
fi
echo "Chain $CHAIN_ID. Deployer holds $balance QIE."

step() { echo; echo "== $1"; }
send() { cast send --rpc-url "$RPC" --json "$@" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['transactionHash']);sys.exit(0 if str(d['status']) in ('1','0x1') else 1)"; }

swap_for_stable() { # key, wallet, QIE amount
  local wrapped path quote minimum deadline now
  wrapped="$(cast call --rpc-url "$RPC" "$DEX_ROUTER" 'WETH()(address)')"
  path="[$wrapped,$STABLECOIN]"
  quote="$(cast call --rpc-url "$RPC" "$DEX_ROUTER" 'getAmountsOut(uint256,address[])(uint256[])' "$(cast to-wei "$3")" "$path" | tr -d '[]' | awk -F', ' '{print $NF}' | cut -d' ' -f1)"
  minimum="$(python3 -c "print($quote * 97 // 100)")"
  now="$(cast block --rpc-url "$RPC" latest --field timestamp)"
  deadline="$(python3 -c "print($now + 600)")"
  send --private-key "$1" --value "$(cast to-wei "$3")" "$DEX_ROUTER" 'swapExactETHForTokens(uint256,address[],address,uint256)' "$minimum" "$path" "$2" "$deadline" >/dev/null
  echo "Swapped $3 QIE to about $(python3 -c "print($quote / 10 ** $(cast call --rpc-url "$RPC" "$STABLECOIN" 'decimals()(uint8)'))") QUSDC for $2"
}

step "Sharing out QIE"
send --private-key "$DEPLOYER_KEY" --value "$(cast to-wei "$QIE_FOR_JEWELLER")" "$JEWELLER" >/dev/null
send --private-key "$DEPLOYER_KEY" --value "$(cast to-wei "$QIE_FOR_CUSTOMER")" "$CUSTOMER" >/dev/null

step "Swapping QIE to QUSDC on QIEDEX"
swap_for_stable "$JEWELLER_KEY" "$JEWELLER" "$(python3 -c "print($QIE_FOR_JEWELLER - $GAS_RESERVE_QIE)")"
swap_for_stable "$CUSTOMER_KEY" "$CUSTOMER" "$(python3 -c "print($QIE_FOR_CUSTOMER - $GAS_RESERVE_QIE)")"

step "Deploying the registry"
forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast --slow --silent
export REGISTRY="$(python3 -c "import json;print(json.load(open('deployments/$CHAIN_ID.json'))['registry'])")"
echo "Registry $REGISTRY"

last_scheme() { cast call --rpc-url "$RPC" "$REGISTRY" 'schemesOf(address)(address[])' "$JEWELLER" | tr -d '[]' | awk -F', ' '{print $NF}'; }

step "Opening a real-months plan"
SCHEME_NAME="Asha Jewellers, 11 months" SCHEME_INSTALMENT_COUNT=11 SCHEME_PERIOD=2592000 SCHEME_GRACE=604800 \
  SCHEME_DELIVERY_WINDOW=2592000 SCHEME_CURE_WINDOW=259200 \
  forge script script/OpenScheme.s.sol --rpc-url "$RPC" --broadcast --slow --silent
REAL_SCHEME="$(last_scheme)"
echo "$REAL_SCHEME"

step "Opening the demo plan"
forge script script/OpenScheme.s.sol --rpc-url "$RPC" --broadcast --slow --silent
SCHEME="$(last_scheme)"
echo "$SCHEME"

DECIMALS="$(cast call --rpc-url "$RPC" "$STABLECOIN" 'decimals()(uint8)')"
INSTALMENT="$(python3 -c "print($SCHEME_INSTALMENT_CENTS * 10 ** $DECIMALS // 100)")"
BOND="$(python3 -c "print($INSTALMENT * ($SCHEME_BOND_BPS + $SCHEME_BONUS_BPS) // 10000)")"

step "Jeweller posts the bond; customer joins"
send --private-key "$JEWELLER_KEY" "$STABLECOIN" 'approve(address,uint256)' "$SCHEME" "$BOND" >/dev/null
send --private-key "$JEWELLER_KEY" "$SCHEME" 'depositBond(uint256)' "$BOND" >/dev/null
send --private-key "$CUSTOMER_KEY" "$STABLECOIN" 'approve(address,uint256)' "$SCHEME" "$INSTALMENT" >/dev/null
send --private-key "$CUSTOMER_KEY" "$SCHEME" 'enrol()' >/dev/null

step "Jeweller tries to take the customer's money, on the chain"
# This must fail. A gas limit is set so the refusal is mined instead of being caught before sending.
PROOF_TX="$(cast send --rpc-url "$RPC" --json --private-key "$JEWELLER_KEY" --gas-limit 200000 "$SCHEME" 'collect(uint256)' 1 | python3 -c "
import json,sys
d=json.load(sys.stdin)
assert str(d['status']) in ('0','0x0'), 'collect did not fail: stop and investigate'
print(d['transactionHash'])")"
echo "Failed as it should: $PROOF_TX"

python3 - "$PROOF_TX" "$CHAIN_ID" <<'PY'
import json, sys
tx, chain = sys.argv[1:3]
json.dump([{
    "label": "The jeweller tries to take a customer's instalments",
    "detail": "The chain refused, because that customer has not confirmed delivery.",
    "tx": tx,
}], open(f"deployments/proofs-{chain}.json", "w"), indent=2)
PY

step "Done"
echo "Registry:          $REGISTRY"
echo "Demo plan:         $SCHEME"
echo "Real-months plan:  $REAL_SCHEME"
echo "Failed collect:    $PROOF_TX"
echo "Jeweller wallet:   $JEWELLER"
echo "Customer wallet:   $CUSTOMER"
