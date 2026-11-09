// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TolaRegistry} from "../src/TolaRegistry.sol";
import {IGoldFeed} from "../src/interfaces/IGoldFeed.sol";
import {MockGoldFeed, MockStable} from "../test/mocks/Mocks.sol";

interface IHistoricalFeed {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
    function getRoundData(uint80) external view returns (uint80, int256, uint256, uint256, uint80);
}

/// @notice Deploys the registry. Addresses and limits come from the environment. With USE_MOCKS=true
///         it deploys a labelled test token and test feed, for chains without QIE's gold oracle.
/// @dev    The registry's price age limit is measured from the feed's real history instead of being
///         guessed: the longest recent gap between updates, times a safety factor.
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_KEY");
        bool useMocks = vm.envOr("USE_MOCKS", false);

        vm.startBroadcast(deployerKey);

        address stablecoin;
        address goldFeed;
        if (useMocks) {
            stablecoin = address(new MockStable());
            goldFeed = address(new MockGoldFeed(vm.envInt("MOCK_GOLD_PRICE")));
        } else {
            stablecoin = vm.envAddress("STABLECOIN");
            goldFeed = vm.envAddress("GOLD_FEED");
        }

        uint32 maxPriceAge = useMocks ? uint32(vm.envUint("MOCK_PRICE_AGE")) : _measuredPriceAge(goldFeed);

        TolaRegistry registry = new TolaRegistry(
            IERC20(stablecoin),
            IGoldFeed(goldFeed),
            TolaRegistry.Limits({
                maxExitFeeBps: uint16(vm.envUint("LIMIT_MAX_EXIT_FEE_BPS")),
                minBondBps: uint16(vm.envUint("LIMIT_MIN_BOND_BPS")),
                maxPriceAge: maxPriceAge
            })
        );

        vm.stopBroadcast();

        console2.log("registry", address(registry));
        console2.log("stablecoin", stablecoin);
        console2.log("goldFeed", goldFeed);
        console2.log("maxPriceAge", maxPriceAge);
        console2.log("mocks", useMocks);

        string memory json = "deployment";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "registry", address(registry));
        vm.serializeAddress(json, "stablecoin", stablecoin);
        vm.serializeAddress(json, "goldFeed", goldFeed);
        vm.serializeUint(json, "maxPriceAge", maxPriceAge);
        string memory output = vm.serializeBool(json, "mocks", useMocks);
        vm.writeJson(output, string.concat("deployments/", vm.toString(block.chainid), ".json"));
    }

    function _measuredPriceAge(address feed) private view returns (uint32) {
        uint256 lookback = vm.envUint("PRICE_AGE_LOOKBACK_ROUNDS");
        uint256 safetyBps = vm.envUint("PRICE_AGE_SAFETY_BPS");

        (uint80 latest,,, uint256 newer,) = IHistoricalFeed(feed).latestRoundData();
        uint256 maxGap;
        for (uint256 i = 1; i <= lookback && latest > i; ++i) {
            (,,, uint256 older,) = IHistoricalFeed(feed).getRoundData(uint80(latest - i));
            if (newer > older && newer - older > maxGap) maxGap = newer - older;
            newer = older;
        }
        require(maxGap != 0, "no feed history");
        console2.log("longest gap between updates (s)", maxGap);
        return uint32((maxGap * safetyBps) / 10_000);
    }
}
