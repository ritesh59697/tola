#!/usr/bin/env bash
# Deploys Tola and prepares the public demo, from one funded deployer wallet:
#   1. shares QIE to the jeweller and customer wallets and swaps some into QUSDC on QIEDEX
#   2. deploys the registry, with the price age measured from the real feed's history
#   3. opens a real-months plan and a demo plan
#   4. has a customer join the real-months plan, then makes one real failed attempt to take their money
#   5. saves that transaction as public proof for the site
# Set RPC to a local fork to rehearse the whole thing first.
set -Eeuo pipefail
# Report where it stopped. Only the line number is printed, because commands here carry private keys.
trap 'echo "Stopped at line $LINENO of scripts/launch.sh. Nothing after that ran." >&2' ERR
cd "$(dirname "$0")/../contracts"

# Public RPC nodes sometimes drop a request. Reads are safe to repeat, so they get a few tries.
# Transactions are never retried here, because a repeat could send twice.
rpc_read() {
  local attempt out
  for attempt in 1 2 3 4 5; do
    if out="$("$@" 2>/dev/null)"; then printf '%s\n' "$out"; return 0; fi
    sleep "$attempt"
  done
  echo "A read from the chain failed five times. Check your connection and the RPC, then run this again." >&2
  return 1
}
set -a; source .env; set +a

RPC="${RPC:-$QIE_MAINNET_RPC}"
DEX_ROUTER="${DEX_ROUTER:-0x08cd2e72e156D8563B4351eb4065C262A9f553Ef}"
# Sized for a budget of about $1. Gas on QIE costs a tiny fraction of a cent per transaction.
QIE_FOR_JEWELLER="${QIE_FOR_JEWELLER:-2}"
QIE_FOR_CUSTOMER="${QIE_FOR_CUSTOMER:-3.5}"
GAS_RESERVE_QIE="${GAS_RESERVE_QIE:-0.3}"
DEPLOY_RESERVE_QIE="${DEPLOY_RESERVE_QIE:-0.3}"
REAL_SCHEME_COUNT="${REAL_SCHEME_COUNT:-11}"

DEPLOYER="$(cast wallet address --private-key "$DEPLOYER_KEY")"
JEWELLER="$(cast wallet address --private-key "$JEWELLER_KEY")"
CUSTOMER="$(cast wallet address --private-key "$CUSTOMER_KEY")"
CHAIN_ID="$(rpc_read cast chain-id --rpc-url "$RPC")"

balance="$(rpc_read cast balance --rpc-url "$RPC" "$DEPLOYER" --ether)"
need="$(python3 -c "print($QIE_FOR_JEWELLER + $QIE_FOR_CUSTOMER + $DEPLOY_RESERVE_QIE)")"
if ! python3 -c "import sys; sys.exit(0 if $balance >= $need else 1)"; then
  echo "Deployer $DEPLOYER holds $balance QIE and needs at least $need."
  exit 1
fi
echo "Chain $CHAIN_ID. Deployer holds $balance QIE."

step() { echo; echo "== $1"; }
send() { cast send --rpc-url "$RPC" --json "$@" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['transactionHash']);sys.exit(0 if str(d['status']) in ('1','0x1') else 1)"; }

swap_for_stable() { # key, wallet, QIE amount
  local wrapped path quote minimum deadline now
  wrapped="$(rpc_read cast call --rpc-url "$RPC" "$DEX_ROUTER" 'WETH()(address)')"
  path="[$wrapped,$STABLECOIN]"
  quote="$(rpc_read cast call --rpc-url "$RPC" "$DEX_ROUTER" 'getAmountsOut(uint256,address[])(uint256[])' "$(cast to-wei "$3")" "$path" | tr -d '[]' | awk -F', ' '{print $NF}' | cut -d' ' -f1)"
  minimum="$(python3 -c "print($quote * 97 // 100)")"
  now="$(rpc_read cast block --rpc-url "$RPC" latest --field timestamp)"
  deadline="$(python3 -c "print($now + 600)")"
  send --private-key "$1" --value "$(cast to-wei "$3")" "$DEX_ROUTER" 'swapExactETHForTokens(uint256,address[],address,uint256)' "$minimum" "$path" "$2" "$deadline" >/dev/null
  echo "Swapped $3 QIE to about $(python3 -c "print($quote / 10 ** $(rpc_read cast call --rpc-url "$RPC" "$STABLECOIN" 'decimals()(uint8)'))") QUSDC for $2"
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
SCHEME_NAME="Asha Jewellers, $REAL_SCHEME_COUNT months" SCHEME_INSTALMENT_COUNT=$REAL_SCHEME_COUNT SCHEME_PERIOD=2592000 SCHEME_GRACE=604800 \
  SCHEME_DELIVERY_WINDOW=2592000 SCHEME_CURE_WINDOW=259200 \
  forge script script/OpenScheme.s.sol --rpc-url "$RPC" --broadcast --slow --silent
REAL_SCHEME="$(last_scheme)"
echo "$REAL_SCHEME"

step "Opening the demo plan"
forge script script/OpenScheme.s.sol --rpc-url "$RPC" --broadcast --slow --silent
SCHEME="$(last_scheme)"
echo "$SCHEME"

DECIMALS="$(rpc_read cast call --rpc-url "$RPC" "$STABLECOIN" 'decimals()(uint8)')"
INSTALMENT="$(python3 -c "print($SCHEME_INSTALMENT_CENTS * 10 ** $DECIMALS // 100)")"
# Exactly one instalment's requirement, so the demo plan's second instalment leaves the bond short.
DEMO_BOND="$(python3 -c "print($INSTALMENT * ($SCHEME_BOND_BPS + $SCHEME_BONUS_BPS) // 10000)")"
# The real-months plan's bond covers its whole first term at the flat minimum and bonus.
REAL_BOND="$(python3 -c "print($INSTALMENT * $REAL_SCHEME_COUNT * ($SCHEME_BOND_BPS + $SCHEME_BONUS_BPS) // 10000)")"

step "Jeweller posts bonds; customer joins the real-months plan"
send --private-key "$JEWELLER_KEY" "$STABLECOIN" 'approve(address,uint256)' "$SCHEME" "$DEMO_BOND" >/dev/null
send --private-key "$JEWELLER_KEY" "$SCHEME" 'depositBond(uint256)' "$DEMO_BOND" >/dev/null
send --private-key "$JEWELLER_KEY" "$STABLECOIN" 'approve(address,uint256)' "$REAL_SCHEME" "$REAL_BOND" >/dev/null
send --private-key "$JEWELLER_KEY" "$REAL_SCHEME" 'depositBond(uint256)' "$REAL_BOND" >/dev/null
send --private-key "$CUSTOMER_KEY" "$STABLECOIN" 'approve(address,uint256)' "$REAL_SCHEME" "$INSTALMENT" >/dev/null
send --private-key "$CUSTOMER_KEY" "$REAL_SCHEME" 'enrol()' >/dev/null

step "Jeweller tries to take the customer's money, on the chain"
# This must fail. A gas limit is set so the refusal is mined instead of being caught before sending.
PROOF_TX="$(cast send --rpc-url "$RPC" --json --private-key "$JEWELLER_KEY" --gas-limit 200000 "$REAL_SCHEME" 'collect(uint256)' 1 | python3 -c "
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
