// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TolaScheme} from "../src/TolaScheme.sol";
import {MockGoldFeed, MockStable} from "./mocks/Mocks.sol";

/// @dev Drives the scheme through random sequences of real actions and records what the jeweller
///      received, so the invariants can check that customer money never reached them unconfirmed.
contract SchemeHandler is Test {
    TolaScheme public scheme;
    MockStable public stable;
    MockGoldFeed public feed;
    address public jeweller;
    address[] public customers;

    uint256 public paidIn; // total instalments ever paid
    uint256 public refundedPrincipal; // principal returned to customers, fees included
    uint256 public confirmedPrincipal; // principal released by customer confirmation
    uint256 public jewellerBondIn;
    uint256 public jewellerBondOut;
    uint256 public collectedByJeweller;
    uint256 public exitFeesToJeweller;

    constructor(
        TolaScheme scheme_,
        MockStable stable_,
        MockGoldFeed feed_,
        address jeweller_,
        address[] memory people
    ) {
        scheme = scheme_;
        stable = stable_;
        feed = feed_;
        jeweller = jeweller_;
        customers = people;
    }

    function _someone(uint256 seed) private view returns (address) {
        return customers[seed % customers.length];
    }

    function _somePlan(uint256 seed) private view returns (uint256) {
        uint256 count = scheme.planCount();
        return count == 0 ? 0 : (seed % count) + 1;
    }

    function enrol(uint256 seed) external {
        vm.prank(_someone(seed));
        try scheme.enrol() {
            paidIn += scheme.terms().instalment;
        } catch {}
    }

    function pay(uint256 seed) external {
        uint256 id = _somePlan(seed);
        if (id == 0) return;
        vm.prank(scheme.plan(id).customer);
        try scheme.payInstalment(id) {
            paidIn += scheme.terms().instalment;
        } catch {}
    }

    function exitPlan(uint256 seed) external {
        uint256 id = _somePlan(seed);
        if (id == 0) return;
        TolaScheme.Plan memory p = scheme.plan(id);
        uint256 jewellerBefore = stable.balanceOf(jeweller);
        vm.prank(p.customer);
        try scheme.exit(id) {
            refundedPrincipal += p.principal;
            exitFeesToJeweller += stable.balanceOf(jeweller) - jewellerBefore;
        } catch {}
    }

    function confirm(uint256 seed) external {
        uint256 id = _somePlan(seed);
        if (id == 0) return;
        TolaScheme.Plan memory p = scheme.plan(id);
        vm.prank(p.customer);
        try scheme.confirmDelivery(id) {
            confirmedPrincipal += p.principal;
        } catch {}
    }

    function jewellerCollect(uint256 seed) external {
        uint256 id = _somePlan(seed);
        if (id == 0) return;
        uint256 principal = scheme.plan(id).principal;
        vm.prank(jeweller);
        try scheme.collect(id) {
            collectedByJeweller += principal;
        } catch {}
    }

    function cashOut(uint256 seed) external {
        uint256 id = _somePlan(seed);
        if (id == 0) return;
        TolaScheme.Plan memory p = scheme.plan(id);
        vm.prank(p.customer);
        try scheme.cashOut(id) {
            refundedPrincipal += p.principal;
        } catch {}
    }

    function bondIn(uint96 amount) external {
        uint256 value = bound(amount, 1, 1000e6);
        vm.prank(jeweller);
        try scheme.depositBond(value) {
            jewellerBondIn += value;
        } catch {}
    }

    function bondOut(uint96 amount) external {
        uint256 value = bound(amount, 1, 1000e6);
        vm.prank(jeweller);
        try scheme.withdrawBond(value) {
            jewellerBondOut += value;
        } catch {}
    }

    function movePrice(uint64 usd) external {
        feed.set(int256(uint256(bound(usd, 500, 20_000))) * 1e8);
    }

    function passTime(uint32 secondsAhead) external {
        vm.warp(block.timestamp + bound(secondsAhead, 1, 40 days));
        feed.set(feed.answer());
    }

    function letPriceGoStale(uint32 secondsAhead) external {
        vm.warp(block.timestamp + bound(secondsAhead, 1, 40 days));
    }

    function flag() external {
        try scheme.flagUnderbacked() {} catch {}
    }

    function clear() external {
        try scheme.clearFlag() {} catch {}
    }

    function declare() external {
        try scheme.declareDefault() {} catch {}
    }

    function runTally(uint8 count) external {
        try scheme.tally(count) {} catch {}
    }

    function claim(uint256 seed) external {
        uint256 id = _somePlan(seed);
        if (id == 0) return;
        TolaScheme.Plan memory p = scheme.plan(id);
        vm.prank(p.customer);
        try scheme.claimInDefault(id) {
            refundedPrincipal += p.principal;
        } catch {}
    }
}

contract TolaSchemeInvariantTest is Test {
    TolaScheme scheme;
    MockStable stable;
    MockGoldFeed feed;
    SchemeHandler handler;
    address jeweller = makeAddr("jeweller");

    function setUp() public {
        vm.warp(1_800_000_000);
        stable = new MockStable();
        feed = new MockGoldFeed(4000e8);
        TolaScheme.Terms memory terms = TolaScheme.Terms({
            instalment: 100e6,
            instalmentCount: 6,
            period: 30 days,
            gracePeriod: 5 days,
            deliveryWindow: 30 days,
            cureWindow: 3 days,
            maxPriceAge: 14 hours,
            bonusBps: 900,
            bondBps: 1500,
            exitFeeBps: 200
        });
        scheme = new TolaScheme(IERC20(address(stable)), feed, jeweller, "Invariant Jewellers", terms);

        address[] memory people = new address[](3);
        people[0] = makeAddr("asha");
        people[1] = makeAddr("ravi");
        people[2] = makeAddr("meera");
        for (uint256 i; i < people.length; ++i) {
            stable.mint(people[i], 1e15);
            vm.prank(people[i]);
            stable.approve(address(scheme), type(uint256).max);
        }
        stable.mint(jeweller, 1e15);
        vm.prank(jeweller);
        stable.approve(address(scheme), type(uint256).max);

        handler = new SchemeHandler(scheme, stable, feed, jeweller, people);
        targetContract(address(handler));
    }

    /// The contract can always pay what its books say it owes.
    function invariant_balanceCoversBooks() public view {
        assertGe(stable.balanceOf(address(scheme)), scheme.accountedBalance());
    }

    /// Every dollar of locked principal is held, and matches paid-in minus money released.
    function invariant_lockedPrincipalMatchesFlows() public view {
        assertEq(
            scheme.lockedPrincipal(), handler.paidIn() - handler.refundedPrincipal() - handler.confirmedPrincipal()
        );
    }

    /// The jeweller can never have collected more than customers confirmed.
    function invariant_jewellerOnlyCollectsConfirmedMoney() public view {
        assertLe(handler.collectedByJeweller(), handler.confirmedPrincipal());
        assertEq(scheme.collectable(), handler.confirmedPrincipal() - handler.collectedByJeweller());
    }

    /// Nothing the jeweller took out exceeds their bond plus confirmed money plus exit fees.
    function invariant_jewellerNetBoundedByEntitlement() public view {
        uint256 start = 1e15;
        uint256 balance = stable.balanceOf(jeweller);
        assertLe(
            balance,
            start + handler.collectedByJeweller() + handler.exitFeesToJeweller() + handler.jewellerBondOut()
                - handler.jewellerBondIn()
        );
    }
}
