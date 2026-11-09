// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {TolaRegistry} from "../src/TolaRegistry.sol";
import {TolaScheme} from "../src/TolaScheme.sol";

/// @notice Opens a scheme from environment settings, as the jeweller. Amounts are given in whole
///         cents and scaled by the stablecoin's real decimals.
contract OpenScheme is Script {
    function run() external {
        uint256 jewellerKey = vm.envUint("JEWELLER_KEY");
        TolaRegistry registry = TolaRegistry(vm.envAddress("REGISTRY"));
        uint256 unit = 10 ** IERC20Metadata(address(registry.stablecoin())).decimals();

        TolaScheme.Terms memory terms = TolaScheme.Terms({
            instalment: (vm.envUint("SCHEME_INSTALMENT_CENTS") * unit) / 100,
            instalmentCount: uint32(vm.envUint("SCHEME_INSTALMENT_COUNT")),
            period: uint32(vm.envUint("SCHEME_PERIOD")),
            gracePeriod: uint32(vm.envUint("SCHEME_GRACE")),
            deliveryWindow: uint32(vm.envUint("SCHEME_DELIVERY_WINDOW")),
            cureWindow: uint32(vm.envUint("SCHEME_CURE_WINDOW")),
            maxPriceAge: registry.maxPriceAge(),
            bonusBps: uint16(vm.envUint("SCHEME_BONUS_BPS")),
            bondBps: uint16(vm.envUint("SCHEME_BOND_BPS")),
            exitFeeBps: uint16(vm.envUint("SCHEME_EXIT_FEE_BPS"))
        });

        vm.startBroadcast(jewellerKey);
        address scheme = registry.openScheme(vm.envString("SCHEME_NAME"), terms);
        vm.stopBroadcast();
        console2.log("scheme", scheme);
    }
}
