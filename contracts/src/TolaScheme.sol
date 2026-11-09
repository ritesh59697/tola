// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IGoldFeed} from "./interfaces/IGoldFeed.sol";

/// @title TolaScheme
/// @notice One jeweller's monthly gold savings plan. Customers pay instalments, each instalment
///         locks a weight of gold at the oracle price of that moment, and the money stays in this
///         contract until the customer confirms they received their jewellery.
/// @dev    There is no owner and no upgrade path. Three promises hold at all times:
///         1. Customer money can only leave to the customer, or to the jeweller after that
///            customer's own confirmation.
///         2. A customer can always get their locked principal back, even if the oracle is dead.
///         3. Token balance >= lockedPrincipal + bond + collectable (see `accountedBalance`).
contract TolaScheme is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Rules of the plan, fixed when the jeweller opens it.
    struct Terms {
        uint256 instalment; // stablecoin base units per instalment
        uint32 instalmentCount; // instalments in a full plan
        uint32 period; // seconds between instalments
        uint32 gracePeriod; // seconds an instalment may be late
        uint32 deliveryWindow; // seconds after maturity the jeweller has to deliver
        uint32 cureWindow; // seconds the jeweller has to repair an under-backed scheme
        uint32 maxPriceAge; // oldest acceptable oracle update, in seconds
        uint16 bonusBps; // extra value on a fully paid p, in basis points of principal
        uint16 bondBps; // minimum bond, in basis points of locked principal
        uint16 exitFeeBps; // fee on leaving before maturity, in basis points of principal
    }

    enum PlanState {
        None,
        Active,
        DeliveryConfirmed,
        Collected,
        Exited,
        CashedOut,
        ClaimedInDefault
    }

    struct Plan {
        address customer;
        PlanState state;
        uint32 paidCount;
        uint64 startedAt;
        uint256 principal; // stablecoin base units paid in
        uint256 goldOz; // troy ounces locked, 18 decimals
    }

    /// @notice All the numbers needed to judge a scheme, in one read.
    struct Backing {
        uint256 lockedPrincipal;
        uint256 bond;
        uint256 requiredBond;
        uint256 goldValue; // value of all locked gold at the current price
        uint256 liability; // the larger of principal and gold value, plus bonus
        uint256 coverageBps; // (principal + bond) / liability, in basis points
        uint256 price;
        uint256 priceUpdatedAt;
        bool priceFresh;
    }

    uint256 private constant BPS = 10_000;

    IERC20 public immutable stablecoin;
    IGoldFeed public immutable goldFeed;
    address public immutable jeweller;
    uint8 public immutable stablecoinDecimals;
    uint8 public immutable feedDecimals;
    /// @dev Converts (stablecoin units, oracle price) to and from 18-decimal ounces.
    uint256 private immutable goldScale;

    string public shopName;
    Terms private _terms;

    uint256 public planCount;
    mapping(uint256 planId => Plan) private _plans;
    mapping(address customer => uint256[]) private _plansOf;

    uint256 public lockedPrincipal;
    uint256 public totalGoldOz;
    uint256 public bond;
    uint256 public collectable;

    uint64 public flaggedAt; // 0 when no flag is open

    bool public defaulted;
    uint256 public defaultPrice;
    uint256 public bondAtDefault;
    uint256 public tallyCursor; // next p id to tally
    uint256 public totalGainAtDefault;
    uint256 public unclaimedPlans; // active plans still to claim after default
    mapping(uint256 planId => uint256) public gainAtDefault;

    event BondDeposited(address indexed from, uint256 amount, uint256 bond);
    event BondWithdrawn(uint256 amount, uint256 bond);
    event Enrolled(uint256 indexed planId, address indexed customer);
    event InstalmentPaid(uint256 indexed planId, uint32 paidCount, uint256 amount, uint256 goldOz, uint256 price);
    event DeliveryConfirmed(uint256 indexed planId, uint256 principal);
    event Collected(uint256 indexed planId, uint256 principal);
    event Exited(uint256 indexed planId, uint256 refund, uint256 fee);
    event CashedOut(uint256 indexed planId, uint256 paid, uint256 fromBond);
    event Flagged(address indexed by, uint256 bond, uint256 requiredBond, uint64 curesBy);
    event FlagCleared(address indexed by, uint256 bond, uint256 requiredBond);
    event Defaulted(address indexed by, uint256 price, uint256 priceUpdatedAt, uint256 bond);
    event Tallied(uint256 throughPlanId, uint256 totalGain, bool complete);
    event ClaimedInDefault(uint256 indexed planId, uint256 principal, uint256 fromBond);
    event ResidualBondReturned(uint256 amount);

    error NotJeweller();
    error NotPlanCustomer(uint256 planId);
    error SchemeInDefault();
    error SchemeNotInDefault();
    error SchemeUnderReview(uint64 curesBy);
    error StalePrice(uint256 updatedAt, uint32 maxPriceAge);
    error InvalidPrice(int256 answer);
    error InvalidTerms();
    error ZeroAmount();
    error PlanNotActive(uint256 planId);
    error AllInstalmentsPaid(uint256 planId);
    error InstalmentNotDue(uint256 dueAt);
    error PlanLapsed(uint256 lastDueAt);
    error NotMatured(uint256 maturity);
    error DeliveryWindowOpen(uint256 closesAt);
    error CustomerHasNotConfirmed(uint256 planId);
    error BondBelowRequired(uint256 bondAfter, uint256 requiredBond);
    error BondIsSufficient(uint256 bond, uint256 requiredBond);
    error BondCannotCoverGain(uint256 bond, uint256 gain);
    error AlreadyFlagged();
    error NotFlagged();
    error CureWindowOpen(uint256 closesAt);
    error TallyIncomplete(uint256 nextPlanId, uint256 planCount);
    error ClaimsOutstanding(uint256 unclaimedPlans);

    constructor(
        IERC20 stablecoin_,
        IGoldFeed goldFeed_,
        address jeweller_,
        string memory shopName_,
        Terms memory terms_
    ) {
        if (
            terms_.instalment == 0 || terms_.instalmentCount == 0 || terms_.period == 0 || terms_.cureWindow == 0
                || terms_.maxPriceAge == 0 || terms_.bondBps > BPS || terms_.exitFeeBps > BPS
        ) revert InvalidTerms();

        stablecoin = stablecoin_;
        goldFeed = goldFeed_;
        jeweller = jeweller_;
        shopName = shopName_;
        _terms = terms_;

        stablecoinDecimals = IERC20Metadata(address(stablecoin_)).decimals();
        feedDecimals = goldFeed_.decimals();
        goldScale = 10 ** (18 + uint256(feedDecimals) - uint256(stablecoinDecimals));
    }

    modifier onlyJeweller() {
        if (msg.sender != jeweller) revert NotJeweller();
        _;
    }

    modifier onlyPlanCustomer(uint256 planId) {
        if (_plans[planId].customer != msg.sender) revert NotPlanCustomer(planId);
        _;
    }

    modifier notInDefault() {
        if (defaulted) revert SchemeInDefault();
        _;
    }

    // ---------------------------------------------------------------------------------------------
    // Jeweller
    // ---------------------------------------------------------------------------------------------

    /// @notice Add to the bond that backs customers' gold gains and bonus.
    function depositBond(uint256 amount) external nonReentrant notInDefault {
        if (amount == 0) revert ZeroAmount();
        bond += amount;
        emit BondDeposited(msg.sender, amount, bond);
        stablecoin.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Take back bond above the required level. Needs a fresh price, because the
    ///         requirement depends on gold.
    function withdrawBond(uint256 amount) external nonReentrant onlyJeweller notInDefault {
        if (amount == 0) revert ZeroAmount();
        if (flaggedAt != 0) revert SchemeUnderReview(_curesBy());
        (uint256 price,) = _freshPrice();
        uint256 required = _requiredBond(price);
        if (amount > bond || bond - amount < required) {
            revert BondBelowRequired(amount > bond ? 0 : bond - amount, required);
        }
        bond -= amount;
        emit BondWithdrawn(amount, bond);
        stablecoin.safeTransfer(jeweller, amount);
    }

    /// @notice Take a customer's instalments. Only works after that customer confirmed delivery.
    /// @dev    This is the function a dishonest jeweller would try. It reverts for every plan the
    ///         customer has not confirmed, and no other path pays customer money to the jeweller
    ///         except the exit fee the customer accepted by leaving early.
    function collect(uint256 planId) external nonReentrant onlyJeweller {
        Plan storage p = _plans[planId];
        if (p.state != PlanState.DeliveryConfirmed) revert CustomerHasNotConfirmed(planId);
        uint256 amount = p.principal;
        p.state = PlanState.Collected;
        collectable -= amount;
        emit Collected(planId, amount);
        stablecoin.safeTransfer(jeweller, amount);
    }

    // ---------------------------------------------------------------------------------------------
    // Customer
    // ---------------------------------------------------------------------------------------------

    /// @notice Join the plan and pay the first instalment.
    function enrol() external nonReentrant notInDefault returns (uint256 planId) {
        if (flaggedAt != 0) revert SchemeUnderReview(_curesBy());
        planId = ++planCount;
        Plan storage p = _plans[planId];
        p.customer = msg.sender;
        p.state = PlanState.Active;
        p.startedAt = uint64(block.timestamp);
        _plansOf[msg.sender].push(planId);
        emit Enrolled(planId, msg.sender);
        _takeInstalment(planId, p);
    }

    /// @notice Pay the next instalment. Not early, and not after the grace period.
    function payInstalment(uint256 planId) external nonReentrant notInDefault onlyPlanCustomer(planId) {
        if (flaggedAt != 0) revert SchemeUnderReview(_curesBy());
        Plan storage p = _plans[planId];
        if (p.state != PlanState.Active) revert PlanNotActive(planId);
        Terms memory t = _terms;
        if (p.paidCount >= t.instalmentCount) revert AllInstalmentsPaid(planId);
        uint256 dueAt = uint256(p.startedAt) + uint256(p.paidCount) * t.period;
        if (block.timestamp < dueAt) revert InstalmentNotDue(dueAt);
        if (block.timestamp > dueAt + t.gracePeriod) revert PlanLapsed(dueAt + t.gracePeriod);
        _takeInstalment(planId, p);
    }

    /// @notice Confirm at the counter that you received your jewellery. This is the only thing
    ///         that lets the jeweller collect this plan's money.
    function confirmDelivery(uint256 planId) external nonReentrant onlyPlanCustomer(planId) notInDefault {
        Plan storage p = _plans[planId];
        if (p.state != PlanState.Active) revert PlanNotActive(planId);
        uint256 maturity = _maturesAt(p);
        if (block.timestamp < maturity) revert NotMatured(maturity);
        p.state = PlanState.DeliveryConfirmed;
        lockedPrincipal -= p.principal;
        totalGoldOz -= p.goldOz;
        collectable += p.principal;
        emit DeliveryConfirmed(planId, p.principal);
    }

    /// @notice Leave before delivery and get principal back, minus the exit fee. Uses no oracle,
    ///         so it keeps working if the price feed stops.
    /// @dev    Allowed while a flag is open, and fee-free then, so no customer is trapped.
    function exit(uint256 planId) external nonReentrant onlyPlanCustomer(planId) notInDefault {
        Plan storage p = _plans[planId];
        if (p.state != PlanState.Active) revert PlanNotActive(planId);
        uint256 principal = p.principal;
        uint256 fee = flaggedAt == 0 ? (principal * _terms.exitFeeBps) / BPS : 0;
        p.state = PlanState.Exited;
        lockedPrincipal -= principal;
        totalGoldOz -= p.goldOz;
        emit Exited(planId, principal - fee, fee);
        stablecoin.safeTransfer(p.customer, principal - fee);
        if (fee != 0) stablecoin.safeTransfer(jeweller, fee);
    }

    /// @notice If the jeweller did not deliver in time, take the plan's gold value in cash.
    ///         Principal comes from the locked instalments, and any gain plus bonus from the bond.
    function cashOut(uint256 planId) external nonReentrant onlyPlanCustomer(planId) notInDefault {
        Plan storage p = _plans[planId];
        if (p.state != PlanState.Active) revert PlanNotActive(planId);
        uint256 closesAt = _maturesAt(p) + _terms.deliveryWindow;
        if (block.timestamp <= closesAt) revert DeliveryWindowOpen(closesAt);

        (uint256 price,) = _freshPrice();
        uint256 principal = p.principal;
        uint256 fromBond = _planGain(p, price) + _planBonus(p);
        if (fromBond > bond) revert BondCannotCoverGain(bond, fromBond);

        p.state = PlanState.CashedOut;
        lockedPrincipal -= principal;
        totalGoldOz -= p.goldOz;
        bond -= fromBond;
        emit CashedOut(planId, principal + fromBond, fromBond);
        stablecoin.safeTransfer(p.customer, principal + fromBond);
    }

    // ---------------------------------------------------------------------------------------------
    // Anyone: watching the scheme
    // ---------------------------------------------------------------------------------------------

    /// @notice Open the repair clock when the bond is below what the scheme requires.
    /// @dev    With a stale price only the flat bond minimum is checked, so a dead oracle can
    ///         neither create a false flag nor block a true one.
    function flagUnderbacked() external notInDefault {
        if (flaggedAt != 0) revert AlreadyFlagged();
        (uint256 price, bool fresh) = _latestPrice();
        uint256 required = _requiredBond(fresh ? price : 0);
        if (bond >= required) revert BondIsSufficient(bond, required);
        flaggedAt = uint64(block.timestamp);
        emit Flagged(msg.sender, bond, required, _curesBy());
    }

    /// @notice Close the flag once the jeweller has repaired the bond.
    function clearFlag() external notInDefault {
        if (flaggedAt == 0) revert NotFlagged();
        (uint256 price, bool fresh) = _latestPrice();
        uint256 required = _requiredBond(fresh ? price : 0);
        if (bond < required) revert BondBelowRequired(bond, required);
        flaggedAt = 0;
        emit FlagCleared(msg.sender, bond, required);
    }

    /// @notice End the scheme when the jeweller did not repair the bond in time. Freezes the
    ///         price that customers' gains are measured at.
    function declareDefault() external notInDefault {
        if (flaggedAt == 0) revert NotFlagged();
        uint256 closesAt = _curesBy();
        if (block.timestamp < closesAt) revert CureWindowOpen(closesAt);

        (uint256 price, bool fresh) = _latestPrice();
        uint256 required = _requiredBond(fresh ? price : 0);
        if (bond >= required) revert BondIsSufficient(bond, required);

        defaulted = true;
        defaultPrice = price;
        bondAtDefault = bond;
        tallyCursor = 1;
        (, uint256 updatedAt) = _readFeed();
        emit Defaulted(msg.sender, price, updatedAt, bond);
    }

    /// @notice Add up customers' gains after default, in batches so no plan count can block it.
    function tally(uint256 maxPlans) external {
        if (!defaulted) revert SchemeNotInDefault();
        uint256 cursor = tallyCursor;
        uint256 end = planCount;
        uint256 total = totalGainAtDefault;
        uint256 pending = unclaimedPlans;
        for (uint256 n; n < maxPlans && cursor <= end; ++n) {
            Plan storage p = _plans[cursor];
            if (p.state == PlanState.Active) {
                uint256 gain = _planGain(p, defaultPrice);
                gainAtDefault[cursor] = gain;
                total += gain;
                ++pending;
            }
            ++cursor;
        }
        tallyCursor = cursor;
        totalGainAtDefault = total;
        unclaimedPlans = pending;
        emit Tallied(cursor - 1, total, cursor > end);
    }

    /// @notice After default, take back principal in full plus your share of the bond for gains.
    /// @dev    Principal is always whole, because it was never allowed to leave. If the bond cannot
    ///         cover every gain, each customer gets the same fraction of theirs.
    function claimInDefault(uint256 planId) external nonReentrant onlyPlanCustomer(planId) {
        if (!defaulted) revert SchemeNotInDefault();
        if (tallyCursor <= planCount) revert TallyIncomplete(tallyCursor, planCount);
        Plan storage p = _plans[planId];
        if (p.state != PlanState.Active) revert PlanNotActive(planId);

        uint256 principal = p.principal;
        uint256 fromBond = _claimableGain(planId);

        p.state = PlanState.ClaimedInDefault;
        lockedPrincipal -= principal;
        totalGoldOz -= p.goldOz;
        bond -= fromBond;
        --unclaimedPlans;
        emit ClaimedInDefault(planId, principal, fromBond);
        stablecoin.safeTransfer(p.customer, principal + fromBond);
    }

    /// @notice After every customer has claimed, return what is left of the bond to the jeweller.
    function returnResidualBond() external nonReentrant {
        if (!defaulted) revert SchemeNotInDefault();
        if (tallyCursor <= planCount) revert TallyIncomplete(tallyCursor, planCount);
        if (unclaimedPlans != 0) revert ClaimsOutstanding(unclaimedPlans);
        uint256 amount = bond;
        if (amount == 0) revert ZeroAmount();
        bond = 0;
        emit ResidualBondReturned(amount);
        stablecoin.safeTransfer(jeweller, amount);
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    function terms() external view returns (Terms memory) {
        return _terms;
    }

    function plan(uint256 planId) external view returns (Plan memory) {
        return _plans[planId];
    }

    function plansOf(address customer) external view returns (uint256[] memory) {
        return _plansOf[customer];
    }

    /// @notice What the contract must hold. The token balance is never below this.
    function accountedBalance() public view returns (uint256) {
        return lockedPrincipal + bond + collectable;
    }

    /// @notice The bond the scheme requires at the current price. With a stale price this shows
    ///         the flat minimum only, and `backing().priceFresh` says so.
    function requiredBond() external view returns (uint256) {
        (uint256 price, bool fresh) = _latestPrice();
        return _requiredBond(fresh ? price : 0);
    }

    /// @notice What the plan could be settled for now if the price is `price`.
    function planValue(uint256 planId, uint256 price) external view returns (uint256 gain, uint256 bonus) {
        Plan storage p = _plans[planId];
        return (_planGain(p, price), _planBonus(p));
    }

    function maturesAt(uint256 planId) external view returns (uint256) {
        return _maturesAt(_plans[planId]);
    }

    function claimableGain(uint256 planId) external view returns (uint256) {
        return _claimableGain(planId);
    }

    function curesBy() external view returns (uint256) {
        return flaggedAt == 0 ? 0 : _curesBy();
    }

    function backing() external view returns (Backing memory b) {
        (uint256 price, bool fresh) = _latestPrice();
        (, uint256 updatedAt) = _readFeed();
        uint256 goldValue = _goldValue(totalGoldOz, price);
        uint256 bonus = (lockedPrincipal * _terms.bonusBps) / BPS;
        uint256 liability = (goldValue > lockedPrincipal ? goldValue : lockedPrincipal) + bonus;
        b = Backing({
            lockedPrincipal: lockedPrincipal,
            bond: bond,
            requiredBond: _requiredBond(fresh ? price : 0),
            goldValue: goldValue,
            liability: liability,
            coverageBps: liability == 0 ? BPS : ((lockedPrincipal + bond) * BPS) / liability,
            price: price,
            priceUpdatedAt: updatedAt,
            priceFresh: fresh
        });
    }

    // ---------------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------------

    function _takeInstalment(uint256 planId, Plan storage p) private {
        (uint256 price,) = _freshPrice();
        uint256 amount = _terms.instalment;
        uint256 goldOz = (amount * goldScale) / price;

        p.principal += amount;
        p.goldOz += goldOz;
        p.paidCount += 1;
        lockedPrincipal += amount;
        totalGoldOz += goldOz;

        emit InstalmentPaid(planId, p.paidCount, amount, goldOz, price);
        stablecoin.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @dev The flat minimum, or the current gold gain if that is larger, plus the bonus owed.
    ///      `price == 0` means no usable price, so only the flat minimum and bonus count. The gain
    ///      here is measured across the whole scheme, which can only understate the sum of each
    ///      plan's gain, so a flag raised on it is never false.
    function _requiredBond(uint256 price) private view returns (uint256) {
        uint256 floor = (lockedPrincipal * _terms.bondBps) / BPS;
        uint256 goldValue = price == 0 ? 0 : _goldValue(totalGoldOz, price);
        uint256 gain = goldValue > lockedPrincipal ? goldValue - lockedPrincipal : 0;
        uint256 bonus = (lockedPrincipal * _terms.bonusBps) / BPS;
        return (gain > floor ? gain : floor) + bonus;
    }

    function _goldValue(uint256 goldOz, uint256 price) private view returns (uint256) {
        return (goldOz * price) / goldScale;
    }

    function _planGain(Plan storage p, uint256 price) private view returns (uint256) {
        uint256 value = _goldValue(p.goldOz, price);
        return value > p.principal ? value - p.principal : 0;
    }

    function _planBonus(Plan storage p) private view returns (uint256) {
        return p.paidCount == _terms.instalmentCount ? (p.principal * _terms.bonusBps) / BPS : 0;
    }

    function _maturesAt(Plan storage p) private view returns (uint256) {
        return uint256(p.startedAt) + uint256(_terms.instalmentCount) * _terms.period;
    }

    function _claimableGain(uint256 planId) private view returns (uint256) {
        uint256 gain = gainAtDefault[planId];
        if (gain == 0 || totalGainAtDefault == 0) return 0;
        if (bondAtDefault >= totalGainAtDefault) return gain;
        return (gain * bondAtDefault) / totalGainAtDefault;
    }

    function _curesBy() private view returns (uint64) {
        return flaggedAt + _terms.cureWindow;
    }

    /// @dev Never reverts. A feed that reverts or reports nonsense reads as "no usable price", so
    ///      a broken oracle cannot stop the default process or customers' claims.
    function _readFeed() private view returns (int256 answer, uint256 updatedAt) {
        try goldFeed.latestRoundData() returns (uint80, int256 a, uint256, uint256 u, uint80) {
            return (a, u);
        } catch {
            return (0, 0);
        }
    }

    function _latestPrice() private view returns (uint256 price, bool fresh) {
        (int256 answer, uint256 updatedAt) = _readFeed();
        if (answer <= 0) return (0, false);
        price = uint256(answer);
        fresh = updatedAt != 0 && updatedAt <= block.timestamp && block.timestamp - updatedAt <= _terms.maxPriceAge;
    }

    function _freshPrice() private view returns (uint256 price, uint256 updatedAt) {
        int256 answer;
        (answer, updatedAt) = _readFeed();
        if (answer <= 0) revert InvalidPrice(answer);
        if (updatedAt > block.timestamp || block.timestamp - updatedAt > _terms.maxPriceAge) {
            revert StalePrice(updatedAt, _terms.maxPriceAge);
        }
        price = uint256(answer);
    }
}
