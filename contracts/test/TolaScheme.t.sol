// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TolaScheme} from "../src/TolaScheme.sol";
import {TolaRegistry} from "../src/TolaRegistry.sol";
import {MockGoldFeed, MockStable} from "./mocks/Mocks.sol";

contract TolaSchemeTest is Test {
    uint256 constant USD = 1e6;
    int256 constant GOLD_PRICE = 4000e8;
    uint256 constant INSTALMENT = 100 * USD;
    uint32 constant COUNT = 11;
    uint32 constant PERIOD = 30 days;
    uint32 constant GRACE = 5 days;
    uint32 constant DELIVERY_WINDOW = 30 days;
    uint32 constant CURE_WINDOW = 3 days;
    uint32 constant MAX_PRICE_AGE = 14 hours;
    uint16 constant BONUS_BPS = 900;
    uint16 constant BOND_BPS = 1500;
    uint16 constant EXIT_FEE_BPS = 200;

    MockStable stable;
    MockGoldFeed feed;
    TolaRegistry registry;
    TolaScheme scheme;

    address jeweller = makeAddr("jeweller");
    address asha = makeAddr("asha");
    address ravi = makeAddr("ravi");
    address stranger = makeAddr("stranger");

    function setUp() public {
        vm.warp(1_800_000_000);
        stable = new MockStable();
        feed = new MockGoldFeed(GOLD_PRICE);
        registry = new TolaRegistry(
            IERC20(address(stable)),
            feed,
            TolaRegistry.Limits({maxExitFeeBps: 1000, minBondBps: 1000, maxPriceAge: 1 days})
        );

        vm.prank(jeweller);
        scheme = TolaScheme(registry.openScheme("Asha Jewellers", _terms()));

        for (uint256 i; i < 3; ++i) {
            address who = i == 0 ? jeweller : i == 1 ? asha : ravi;
            stable.mint(who, 1_000_000 * USD);
            vm.prank(who);
            stable.approve(address(scheme), type(uint256).max);
        }
    }

    function _terms() internal pure returns (TolaScheme.Terms memory) {
        return TolaScheme.Terms({
            instalment: INSTALMENT,
            instalmentCount: COUNT,
            period: PERIOD,
            gracePeriod: GRACE,
            deliveryWindow: DELIVERY_WINDOW,
            cureWindow: CURE_WINDOW,
            maxPriceAge: MAX_PRICE_AGE,
            bonusBps: BONUS_BPS,
            bondBps: BOND_BPS,
            exitFeeBps: EXIT_FEE_BPS
        });
    }

    function _bond(uint256 amount) internal {
        vm.prank(jeweller);
        scheme.depositBond(amount);
    }

    function _enrol(address who) internal returns (uint256 id) {
        vm.prank(who);
        id = scheme.enrol();
    }

    /// Pays every remaining instalment, moving the clock and keeping the feed fresh.
    function _payAll(uint256 planId, address who) internal {
        TolaScheme.Plan memory p = scheme.plan(planId);
        for (uint256 i = p.paidCount; i < COUNT; ++i) {
            vm.warp(uint256(p.startedAt) + i * PERIOD);
            feed.set(feed.answer());
            vm.prank(who);
            scheme.payInstalment(planId);
        }
    }

    function _toMaturity(uint256 planId) internal {
        vm.warp(scheme.maturesAt(planId));
        feed.set(feed.answer());
    }

    function _assertBooksBalance() internal view {
        assertGe(stable.balanceOf(address(scheme)), scheme.accountedBalance(), "balance below books");
    }

    // ---- enrol and instalments ------------------------------------------------------------------

    function test_enrol_locksGoldAtOraclePrice() public {
        uint256 id = _enrol(asha);
        TolaScheme.Plan memory p = scheme.plan(id);
        assertEq(p.customer, asha);
        assertEq(p.principal, INSTALMENT);
        assertEq(p.paidCount, 1);
        assertEq(p.goldOz, 0.025e18); // $100 at $4,000/oz
        assertEq(stable.balanceOf(address(scheme)), INSTALMENT);
    }

    function test_instalment_lockedPriceMovesWithOracle() public {
        uint256 id = _enrol(asha);
        vm.warp(block.timestamp + PERIOD);
        feed.set(5000e8);
        vm.prank(asha);
        scheme.payInstalment(id);
        assertEq(scheme.plan(id).goldOz, 0.025e18 + 0.02e18);
    }

    function test_instalment_revertsBeforeDue() public {
        uint256 id = _enrol(asha);
        vm.prank(asha);
        vm.expectRevert(abi.encodeWithSelector(TolaScheme.InstalmentNotDue.selector, block.timestamp + PERIOD));
        scheme.payInstalment(id);
    }

    function test_instalment_revertsAfterGrace() public {
        uint256 id = _enrol(asha);
        uint256 lastDue = block.timestamp + PERIOD + GRACE;
        vm.warp(lastDue + 1);
        feed.set(GOLD_PRICE);
        vm.prank(asha);
        vm.expectRevert(abi.encodeWithSelector(TolaScheme.PlanLapsed.selector, lastDue));
        scheme.payInstalment(id);
    }

    function test_instalment_revertsWhenFullyPaid() public {
        uint256 id = _enrol(asha);
        _payAll(id, asha);
        vm.prank(asha);
        vm.expectRevert(abi.encodeWithSelector(TolaScheme.AllInstalmentsPaid.selector, id));
        scheme.payInstalment(id);
    }

    function test_instalment_onlyPlanCustomer() public {
        uint256 id = _enrol(asha);
        vm.prank(ravi);
        vm.expectRevert(abi.encodeWithSelector(TolaScheme.NotPlanCustomer.selector, id));
        scheme.payInstalment(id);
    }

    function test_enrol_revertsOnStalePrice() public {
        vm.warp(block.timestamp + MAX_PRICE_AGE + 1);
        vm.prank(asha);
        vm.expectRevert();
        scheme.enrol();
    }

    function test_enrol_revertsOnBadPrice() public {
        feed.set(0);
        vm.prank(asha);
        vm.expectRevert(abi.encodeWithSelector(TolaScheme.InvalidPrice.selector, int256(0)));
        scheme.enrol();
    }

    // ---- the promise: the jeweller cannot take the money ----------------------------------------

    function test_collect_revertsWithoutCustomerConfirmation() public {
        uint256 id = _enrol(asha);
        vm.prank(jeweller);
        vm.expectRevert(abi.encodeWithSelector(TolaScheme.CustomerHasNotConfirmed.selector, id));
        scheme.collect(id);
    }

    function test_collect_revertsEvenAtMaturity() public {
        uint256 id = _enrol(asha);
        _payAll(id, asha);
        _toMaturity(id);
        vm.prank(jeweller);
        vm.expectRevert(abi.encodeWithSelector(TolaScheme.CustomerHasNotConfirmed.selector, id));
        scheme.collect(id);
    }

    function test_collect_strangerCannot() public {
        uint256 id = _enrol(asha);
        vm.prank(stranger);
        vm.expectRevert(TolaScheme.NotJeweller.selector);
        scheme.collect(id);
    }

    function test_withdrawBond_cannotDrainBelowRequired() public {
        _bond(50 * USD);
        _enrol(asha);
        uint256 required = scheme.requiredBond();
        vm.prank(jeweller);
        vm.expectRevert(abi.encodeWithSelector(TolaScheme.BondBelowRequired.selector, required - 1, required));
        scheme.withdrawBond(50 * USD - required + 1);
    }

    function test_withdrawBond_cannotTakeMoreThanBond() public {
        _bond(50 * USD);
        uint256 id = _enrol(asha);
        uint256 required = scheme.requiredBond();
        uint256 everything = 50 * USD + scheme.plan(id).principal;
        vm.prank(jeweller);
        vm.expectRevert(abi.encodeWithSelector(TolaScheme.BondBelowRequired.selector, 0, required));
        scheme.withdrawBond(everything);
    }

    function test_withdrawBond_excessIsAllowed() public {
        _bond(1000 * USD);
        _enrol(asha);
        uint256 before = stable.balanceOf(jeweller);
        uint256 free = scheme.bond() - scheme.requiredBond();
        vm.prank(jeweller);
        scheme.withdrawBond(free);
        assertEq(stable.balanceOf(jeweller), before + free);
        assertEq(scheme.bond(), scheme.requiredBond());
    }

    function test_withdrawBond_revertsOnStalePrice() public {
        _bond(1000 * USD);
        vm.warp(block.timestamp + MAX_PRICE_AGE + 1);
        vm.prank(jeweller);
        vm.expectRevert();
        scheme.withdrawBond(1);
    }

    function test_withdrawBond_onlyJeweller() public {
        _bond(1000 * USD);
        vm.prank(stranger);
        vm.expectRevert(TolaScheme.NotJeweller.selector);
        scheme.withdrawBond(1);
    }

    // ---- happy path -----------------------------------------------------------------------------

    function test_delivery_thenJewellerCollects() public {
        _bond(1000 * USD);
        uint256 id = _enrol(asha);
        _payAll(id, asha);
        _toMaturity(id);

        vm.prank(asha);
        scheme.confirmDelivery(id);

        uint256 principal = COUNT * INSTALMENT;
        assertEq(scheme.lockedPrincipal(), 0);
        assertEq(scheme.collectable(), principal);

        uint256 before = stable.balanceOf(jeweller);
        vm.prank(jeweller);
        scheme.collect(id);
        assertEq(stable.balanceOf(jeweller), before + principal);
        assertEq(scheme.collectable(), 0);

        vm.prank(jeweller);
        vm.expectRevert(abi.encodeWithSelector(TolaScheme.CustomerHasNotConfirmed.selector, id));
        scheme.collect(id);
    }

    function test_delivery_revertsBeforeMaturity() public {
        uint256 id = _enrol(asha);
        uint256 maturesAt = scheme.maturesAt(id);
        vm.prank(asha);
        vm.expectRevert(abi.encodeWithSelector(TolaScheme.NotMatured.selector, maturesAt));
        scheme.confirmDelivery(id);
    }

    function test_delivery_onlyCustomer() public {
        uint256 id = _enrol(asha);
        _toMaturity(id);
        vm.prank(jeweller);
        vm.expectRevert(abi.encodeWithSelector(TolaScheme.NotPlanCustomer.selector, id));
        scheme.confirmDelivery(id);
    }

    // ---- exit -----------------------------------------------------------------------------------

    function test_exit_refundsPrincipalMinusFee() public {
        uint256 id = _enrol(asha);
        uint256 before = stable.balanceOf(asha);
        uint256 jewellerBefore = stable.balanceOf(jeweller);
        vm.prank(asha);
        scheme.exit(id);
        uint256 fee = (INSTALMENT * EXIT_FEE_BPS) / 10_000;
        assertEq(stable.balanceOf(asha), before + INSTALMENT - fee);
        assertEq(stable.balanceOf(jeweller), jewellerBefore + fee);
        assertEq(scheme.lockedPrincipal(), 0);
        assertEq(scheme.totalGoldOz(), 0);
    }

    function test_exit_worksWithDeadOracle() public {
        uint256 id = _enrol(asha);
        vm.warp(block.timestamp + 365 days);
        feed.set(-1);
        vm.prank(asha);
        scheme.exit(id);
        assertEq(uint256(scheme.plan(id).state), uint256(TolaScheme.PlanState.Exited));
    }

    function test_exit_isFreeWhileFlagged() public {
        uint256 id = _enrol(asha);
        scheme.flagUnderbacked();
        uint256 before = stable.balanceOf(asha);
        vm.prank(asha);
        scheme.exit(id);
        assertEq(stable.balanceOf(asha), before + INSTALMENT);
    }

    function test_exit_twiceReverts() public {
        uint256 id = _enrol(asha);
        vm.startPrank(asha);
        scheme.exit(id);
        vm.expectRevert(abi.encodeWithSelector(TolaScheme.PlanNotActive.selector, id));
        scheme.exit(id);
        vm.stopPrank();
    }

    // ---- cash out when not delivered ------------------------------------------------------------

    function test_cashOut_paysGoldValueAndBonusFromBond() public {
        _bond(5000 * USD);
        uint256 id = _enrol(asha);
        _payAll(id, asha);
        vm.warp(scheme.maturesAt(id) + DELIVERY_WINDOW + 1);
        feed.set(5000e8); // gold up 25%

        uint256 principal = COUNT * INSTALMENT;
        uint256 goldValue = (principal * 125) / 100;
        uint256 bonus = (principal * BONUS_BPS) / 10_000;

        uint256 before = stable.balanceOf(asha);
        vm.prank(asha);
        scheme.cashOut(id);
        assertEq(stable.balanceOf(asha), before + goldValue + bonus);
        assertEq(scheme.bond(), 5000 * USD - (goldValue - principal) - bonus);
    }

    function test_cashOut_goldFall_stillGetsPrincipal() public {
        _bond(5000 * USD);
        uint256 id = _enrol(asha);
        _payAll(id, asha);
        vm.warp(scheme.maturesAt(id) + DELIVERY_WINDOW + 1);
        feed.set(2000e8);

        uint256 principal = COUNT * INSTALMENT;
        uint256 bonus = (principal * BONUS_BPS) / 10_000;
        uint256 before = stable.balanceOf(asha);
        vm.prank(asha);
        scheme.cashOut(id);
        assertEq(stable.balanceOf(asha), before + principal + bonus);
    }

    function test_cashOut_revertsDuringDeliveryWindow() public {
        uint256 id = _enrol(asha);
        _toMaturity(id);
        uint256 closesAt = scheme.maturesAt(id) + DELIVERY_WINDOW;
        vm.prank(asha);
        vm.expectRevert(abi.encodeWithSelector(TolaScheme.DeliveryWindowOpen.selector, closesAt));
        scheme.cashOut(id);
    }

    function test_cashOut_lapsedPlanGetsNoBonus() public {
        _bond(5000 * USD);
        uint256 id = _enrol(asha);
        vm.warp(scheme.maturesAt(id) + DELIVERY_WINDOW + 1);
        feed.set(GOLD_PRICE);
        uint256 before = stable.balanceOf(asha);
        vm.prank(asha);
        scheme.cashOut(id);
        assertEq(stable.balanceOf(asha), before + INSTALMENT);
    }

    function test_cashOut_revertsWhenBondCannotCover() public {
        _bond(100 * USD);
        uint256 id = _enrol(asha);
        vm.warp(scheme.maturesAt(id) + DELIVERY_WINDOW + 1);
        feed.set(100_000e8);
        vm.prank(asha);
        vm.expectRevert();
        scheme.cashOut(id);
    }

    // ---- under-backed: flag, repair, default ----------------------------------------------------

    function test_flag_revertsWhenBondSufficient() public {
        _bond(1000 * USD);
        _enrol(asha);
        vm.expectRevert();
        scheme.flagUnderbacked();
    }

    function test_flag_goldRiseCanUnderback() public {
        _bond(30 * USD);
        _enrol(asha);
        vm.expectRevert();
        scheme.flagUnderbacked();

        feed.set(8000e8); // gold doubles: gain $100 > bond $30
        scheme.flagUnderbacked();
        assertGt(scheme.flaggedAt(), 0);
    }

    function test_flag_blocksNewMoney() public {
        uint256 id = _enrol(asha);
        scheme.flagUnderbacked();
        uint64 curesBy = uint64(block.timestamp) + CURE_WINDOW;
        vm.prank(ravi);
        vm.expectRevert(abi.encodeWithSelector(TolaScheme.SchemeUnderReview.selector, curesBy));
        scheme.enrol();

        vm.warp(block.timestamp + PERIOD);
        vm.prank(asha);
        vm.expectRevert(abi.encodeWithSelector(TolaScheme.SchemeUnderReview.selector, curesBy));
        scheme.payInstalment(id);
    }

    function test_flag_blocksBondWithdrawal() public {
        _bond(1000 * USD);
        _enrol(asha);
        feed.set(1_000_000e8);
        scheme.flagUnderbacked();
        vm.prank(jeweller);
        vm.expectRevert();
        scheme.withdrawBond(1);
    }

    function test_flag_jewellerCanRepair() public {
        _enrol(asha);
        scheme.flagUnderbacked();
        _bond(1000 * USD);
        scheme.clearFlag();
        assertEq(scheme.flaggedAt(), 0);
    }

    function test_clearFlag_revertsIfNotRepaired() public {
        _enrol(asha);
        scheme.flagUnderbacked();
        vm.expectRevert();
        scheme.clearFlag();
    }

    function test_default_revertsDuringCureWindow() public {
        _enrol(asha);
        scheme.flagUnderbacked();
        vm.expectRevert(abi.encodeWithSelector(TolaScheme.CureWindowOpen.selector, block.timestamp + CURE_WINDOW));
        scheme.declareDefault();
    }

    function test_default_revertsIfRepairedButFlagNotCleared() public {
        _enrol(asha);
        scheme.flagUnderbacked();
        _bond(1000 * USD);
        vm.warp(block.timestamp + CURE_WINDOW);
        feed.set(GOLD_PRICE);
        vm.expectRevert();
        scheme.declareDefault();
    }

    function _toDefault() internal {
        scheme.flagUnderbacked();
        vm.warp(block.timestamp + CURE_WINDOW);
        feed.set(feed.answer());
        scheme.declareDefault();
    }

    function test_default_customerGetsPrincipalAndFullGainWhenBondCovers() public {
        _bond(30 * USD);
        uint256 id = _enrol(asha);
        feed.set(5000e8); // gain $25, required = max(25, 15) + 9 = 34 > 30
        _toDefault();
        scheme.tally(10);

        uint256 before = stable.balanceOf(asha);
        vm.prank(asha);
        scheme.claimInDefault(id);
        assertEq(stable.balanceOf(asha), before + INSTALMENT + 25 * USD);
        _assertBooksBalance();

        uint256 jewellerBefore = stable.balanceOf(jeweller);
        scheme.returnResidualBond();
        assertEq(stable.balanceOf(jeweller), jewellerBefore + 5 * USD);
        assertEq(stable.balanceOf(address(scheme)), 0);
    }

    function test_default_bondShortfallIsSharedByGain() public {
        _bond(10 * USD);
        uint256 a = _enrol(asha);
        feed.set(8000e8); // Asha's $100 is now worth $200: gain $100
        uint256 r = _enrol(ravi); // Ravi's $100 at $8,000: gain $0 now
        feed.set(16000e8); // Asha gain $300, Ravi gain $100
        _toDefault();
        scheme.tally(10);

        assertEq(scheme.totalGainAtDefault(), 400 * USD);
        assertEq(scheme.claimableGain(a), (10 * USD * 300) / 400);
        assertEq(scheme.claimableGain(r), (10 * USD * 100) / 400);

        uint256 aBefore = stable.balanceOf(asha);
        uint256 rBefore = stable.balanceOf(ravi);
        vm.prank(asha);
        scheme.claimInDefault(a);
        vm.prank(ravi);
        scheme.claimInDefault(r);
        assertEq(stable.balanceOf(asha), aBefore + INSTALMENT + 7_500_000);
        assertEq(stable.balanceOf(ravi), rBefore + INSTALMENT + 2_500_000);
        assertEq(scheme.bond(), 0);
    }

    function test_default_withNoBond_principalIsStillWhole() public {
        uint256 id = _enrol(asha);
        _toDefault();
        scheme.tally(1);
        uint256 before = stable.balanceOf(asha);
        vm.prank(asha);
        scheme.claimInDefault(id);
        assertEq(stable.balanceOf(asha), before + INSTALMENT);
    }

    function test_default_worksWithStalePrice() public {
        uint256 id = _enrol(asha);
        scheme.flagUnderbacked();
        vm.warp(block.timestamp + 365 days);
        scheme.declareDefault();
        scheme.tally(1);
        vm.prank(asha);
        scheme.claimInDefault(id);
        assertEq(uint256(scheme.plan(id).state), uint256(TolaScheme.PlanState.ClaimedInDefault));
    }

    function test_default_claimBeforeTallyReverts() public {
        uint256 id = _enrol(asha);
        _toDefault();
        vm.prank(asha);
        vm.expectRevert(abi.encodeWithSelector(TolaScheme.TallyIncomplete.selector, 1, 1));
        scheme.claimInDefault(id);
    }

    function test_default_tallyInBatches() public {
        _enrol(asha);
        _enrol(ravi);
        _enrol(asha);
        _toDefault();
        scheme.tally(2);
        assertEq(scheme.tallyCursor(), 3);
        scheme.tally(2);
        assertEq(scheme.tallyCursor(), 4);
        assertEq(scheme.unclaimedPlans(), 3);
    }

    function test_default_blocksEverythingNew() public {
        _bond(1);
        uint256 id = _enrol(asha);
        _toDefault();

        vm.startPrank(asha);
        vm.expectRevert(TolaScheme.SchemeInDefault.selector);
        scheme.enrol();
        vm.expectRevert(TolaScheme.SchemeInDefault.selector);
        scheme.payInstalment(id);
        vm.expectRevert(TolaScheme.SchemeInDefault.selector);
        scheme.exit(id);
        vm.expectRevert(TolaScheme.SchemeInDefault.selector);
        scheme.confirmDelivery(id);
        vm.stopPrank();

        vm.prank(jeweller);
        vm.expectRevert(TolaScheme.SchemeInDefault.selector);
        scheme.withdrawBond(1);
    }

    function test_default_confirmedPlanCanStillBeCollected() public {
        uint256 id = _enrol(asha);
        _toMaturity(id);
        vm.prank(asha);
        scheme.confirmDelivery(id);

        uint256 other = _enrol(ravi);
        _toDefault();
        scheme.tally(5);

        vm.prank(jeweller);
        scheme.collect(id);
        vm.prank(ravi);
        scheme.claimInDefault(other);
        assertEq(stable.balanceOf(address(scheme)), 0);
    }

    function test_residualBond_waitsForAllClaims() public {
        _bond(1);
        uint256 id = _enrol(asha);
        _toDefault();
        scheme.tally(1);
        vm.expectRevert(abi.encodeWithSelector(TolaScheme.ClaimsOutstanding.selector, 1));
        scheme.returnResidualBond();
        vm.prank(asha);
        scheme.claimInDefault(id);
        scheme.returnResidualBond();
        assertEq(scheme.bond(), 0);
    }

    // ---- views and construction -----------------------------------------------------------------

    function test_backing_reportsCoverage() public {
        _bond(50 * USD);
        _enrol(asha);
        TolaScheme.Backing memory b = scheme.backing();
        assertEq(b.lockedPrincipal, INSTALMENT);
        assertEq(b.goldValue, INSTALMENT);
        assertEq(b.liability, INSTALMENT + 9 * USD);
        assertEq(b.coverageBps, (150 * USD * 10_000) / (109 * USD));
        assertTrue(b.priceFresh);
    }

    function test_backing_emptyScheme() public view {
        TolaScheme.Backing memory b = scheme.backing();
        assertEq(b.coverageBps, 10_000);
    }

    function test_backing_staleFeedShowsNotFresh() public {
        vm.warp(block.timestamp + MAX_PRICE_AGE + 1);
        assertFalse(scheme.backing().priceFresh);
    }

    function test_constructor_rejectsBadTerms() public {
        TolaScheme.Terms memory t = _terms();
        t.instalment = 0;
        vm.expectRevert(TolaScheme.InvalidTerms.selector);
        registry.openScheme("Bad", t);
        t = _terms();
        t.bondBps = 10_001;
        vm.expectRevert(TolaScheme.InvalidTerms.selector);
        registry.openScheme("Bad", t);
    }

    function test_registry_rejectsTermsOutsideLimits() public {
        TolaScheme.Terms memory t = _terms();
        t.exitFeeBps = 1001;
        vm.expectRevert(TolaRegistry.TermsOutsideLimits.selector);
        registry.openScheme("Greedy", t);

        t = _terms();
        t.bondBps = 999;
        vm.expectRevert(TolaRegistry.TermsOutsideLimits.selector);
        registry.openScheme("Unbacked", t);

        t = _terms();
        t.maxPriceAge = 1 days + 1;
        vm.expectRevert(TolaRegistry.TermsOutsideLimits.selector);
        registry.openScheme("Stale", t);
    }

    function test_deadFeed_cannotTrapCustomers() public {
        _bond(1);
        uint256 id = _enrol(asha);
        feed.setBroken(true);

        assertFalse(scheme.backing().priceFresh);

        scheme.flagUnderbacked();
        vm.warp(block.timestamp + CURE_WINDOW);
        scheme.declareDefault();
        scheme.tally(1);

        uint256 before = stable.balanceOf(asha);
        vm.prank(asha);
        scheme.claimInDefault(id);
        assertEq(stable.balanceOf(asha), before + INSTALMENT);
    }

    function test_deadFeed_blocksNewMoneyAndBondWithdrawal() public {
        _bond(1000 * USD);
        feed.setBroken(true);
        vm.prank(asha);
        vm.expectRevert(abi.encodeWithSelector(TolaScheme.InvalidPrice.selector, int256(0)));
        scheme.enrol();
        vm.prank(jeweller);
        vm.expectRevert(abi.encodeWithSelector(TolaScheme.InvalidPrice.selector, int256(0)));
        scheme.withdrawBond(1);
    }

    function test_registry_listsSchemes() public view {
        assertEq(registry.schemeCount(), 1);
        assertEq(registry.schemes()[0], address(scheme));
        assertEq(registry.schemesOf(jeweller)[0], address(scheme));
        assertEq(scheme.jeweller(), jeweller);
        assertEq(scheme.shopName(), "Asha Jewellers");
    }

    // ---- fuzz -----------------------------------------------------------------------------------

    function testFuzz_goldRoundTripNeverOverpays(uint64 priceUsdCents) public {
        int256 price = int256(uint256(bound(priceUsdCents, 100, 10_000_000))) * 1e6;
        feed.set(price);
        uint256 id = _enrol(asha);
        (uint256 gain,) = scheme.planValue(id, uint256(price));
        assertEq(gain, 0, "no gain at the entry price");
        assertLe(scheme.backing().goldValue, INSTALMENT);
    }

    function testFuzz_defaultAlwaysReturnsPrincipal(uint32 bondUsd, uint64 newPriceUsd) public {
        uint256 bondAmount = bound(bondUsd, 0, 14) * USD; // always below the flat minimum
        if (bondAmount != 0) _bond(bondAmount);
        uint256 id = _enrol(asha);
        feed.set(int256(uint256(bound(newPriceUsd, 1, 100_000))) * 1e8);
        _toDefault();
        scheme.tally(1);
        uint256 before = stable.balanceOf(asha);
        vm.prank(asha);
        scheme.claimInDefault(id);
        assertGe(stable.balanceOf(asha), before + INSTALMENT);
        _assertBooksBalance();
    }
}
