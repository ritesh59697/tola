#!/usr/bin/env bash
# Opens a fresh short-timer demo plan and posts its bond, ready for recording.
# Usage: scripts/new-demo-plan.sh "Meera Gold House (demo)"
set -euo pipefail
cd "$(dirname "$0")/../contracts"
set -a; source .env; set +a

export SCHEME_NAME="${1:-$SCHEME_NAME}"
RPC="${RPC:-$QIE_MAINNET_RPC}"
CHAIN_ID="$(cast chain-id --rpc-url "$RPC")"
export REGISTRY="$(python3 -c "import json;print(json.load(open('deployments/$CHAIN_ID.json'))['registry'])")"

forge script script/OpenScheme.s.sol --rpc-url "$RPC" --broadcast --slow --silent

JEWELLER="$(cast wallet address --private-key "$JEWELLER_KEY")"
SCHEME="$(cast call --rpc-url "$RPC" "$REGISTRY" 'schemesOf(address)(address[])' "$JEWELLER" | tr -d '[]' | awk -F', ' '{print $NF}')"
DECIMALS="$(cast call --rpc-url "$RPC" "$STABLECOIN" 'decimals()(uint8)')"
BOND="$(python3 -c "print($SCHEME_INSTALMENT_CENTS * 10 ** $DECIMALS // 100 * ($SCHEME_BOND_BPS + $SCHEME_BONUS_BPS) // 10000)")"

cast send --rpc-url "$RPC" --private-key "$JEWELLER_KEY" "$STABLECOIN" 'approve(address,uint256)' "$SCHEME" "$BOND" >/dev/null
cast send --rpc-url "$RPC" --private-key "$JEWELLER_KEY" "$SCHEME" 'depositBond(uint256)' "$BOND" >/dev/null

echo "Open it at: <your site>/#/scheme/$SCHEME"
