// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {TolaScheme} from "../src/TolaScheme.sol";
import {IGoldFeed} from "../src/interfaces/IGoldFeed.sol";

/// @notice Runs against a fork of QIE mainnet with the real gold feed and the real QUSDC token.
///         Skipped unless QIE_MAINNET_RPC, GOLD_FEED and STABLECOIN are set.
contract GoldFeedForkTest is Test {
    function test_fork_realFeedAndToken() public {
        string memory rpc = vm.envOr("QIE_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);

        IGoldFeed feed = IGoldFeed(vm.envAddress("GOLD_FEED"));
        IERC20 token = IERC20(vm.envAddress("STABLECOIN"));
        uint256 unit = 10 ** IERC20Metadata(address(token)).decimals();

        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        assertGt(answer, 0);
        uint32 age = uint32(block.timestamp - updatedAt) + 1 hours;

        address jeweller = makeAddr("jeweller");
        address asha = makeAddr("asha");
        TolaScheme scheme = new TolaScheme(
            token,
            feed,
            jeweller,
            "Fork Jewellers",
            TolaScheme.Terms({
                instalment: unit,
                instalmentCount: 3,
                period: 60,
                gracePeriod: 600,
                deliveryWindow: 120,
                cureWindow: 120,
                maxPriceAge: age,
                bonusBps: 900,
                bondBps: 1500,
                exitFeeBps: 200
            })
        );

        deal(address(token), asha, 10 * unit);
        vm.startPrank(asha);
        token.approve(address(scheme), type(uint256).max);
        uint256 id = scheme.enrol();
        vm.stopPrank();

        uint256 expected = (unit * 10 ** (18 + uint256(feed.decimals()) - IERC20Metadata(address(token)).decimals()))
            / uint256(answer);
        assertEq(scheme.plan(id).goldOz, expected, "gold locked at the real oracle price");
        assertTrue(scheme.backing().priceFresh);

        vm.prank(jeweller);
        vm.expectRevert(abi.encodeWithSelector(TolaScheme.CustomerHasNotConfirmed.selector, id));
        scheme.collect(id);
    }
}
