#!/usr/bin/env bash
# Opens a fresh short-timer demo plan and posts its bond, ready for recording.
# Usage: scripts/new-demo-plan.sh "Meera Gold House (demo)"
set -Eeuo pipefail
trap 'echo "Stopped at line $LINENO of scripts/new-demo-plan.sh." >&2' ERR
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

export SCHEME_NAME="${1:-$SCHEME_NAME}"
RPC="${RPC:-$QIE_MAINNET_RPC}"
CHAIN_ID="$(rpc_read cast chain-id --rpc-url "$RPC")"
export REGISTRY="$(python3 -c "import json;print(json.load(open('deployments/$CHAIN_ID.json'))['registry'])")"

forge script script/OpenScheme.s.sol --rpc-url "$RPC" --broadcast --slow --silent

JEWELLER="$(cast wallet address --private-key "$JEWELLER_KEY")"
SCHEME="$(rpc_read cast call --rpc-url "$RPC" "$REGISTRY" 'schemesOf(address)(address[])' "$JEWELLER" | tr -d '[]' | awk -F', ' '{print $NF}')"
DECIMALS="$(rpc_read cast call --rpc-url "$RPC" "$STABLECOIN" 'decimals()(uint8)')"
BOND="$(python3 -c "print($SCHEME_INSTALMENT_CENTS * 10 ** $DECIMALS // 100 * ($SCHEME_BOND_BPS + $SCHEME_BONUS_BPS) // 10000)")"

cast send --rpc-url "$RPC" --private-key "$JEWELLER_KEY" "$STABLECOIN" 'approve(address,uint256)' "$SCHEME" "$BOND" >/dev/null
cast send --rpc-url "$RPC" --private-key "$JEWELLER_KEY" "$SCHEME" 'depositBond(uint256)' "$BOND" >/dev/null

echo "Open it at: <your site>/#/scheme/$SCHEME"
