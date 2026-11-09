// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IGoldFeed} from "./interfaces/IGoldFeed.sol";
import {TolaScheme} from "./TolaScheme.sol";

/// @title TolaRegistry
/// @notice Lets any jeweller open a scheme and lets the app list them. Holds no money and has no
///         owner. The stablecoin and gold feed are fixed at deployment for the whole registry.
contract TolaRegistry {
    /// @notice Bounds every scheme must respect, so a jeweller cannot hollow out the promise with
    ///         a confiscatory exit fee, a token bond, or a price age nobody would accept.
    struct Limits {
        uint16 maxExitFeeBps;
        uint16 minBondBps;
        uint32 maxPriceAge;
    }

    IERC20 public immutable stablecoin;
    IGoldFeed public immutable goldFeed;
    uint16 public immutable maxExitFeeBps;
    uint16 public immutable minBondBps;
    uint32 public immutable maxPriceAge;

    address[] private _schemes;
    mapping(address jeweller => address[]) private _schemesOf;

    event SchemeOpened(address indexed scheme, address indexed jeweller, string shopName);

    error TermsOutsideLimits();

    constructor(IERC20 stablecoin_, IGoldFeed goldFeed_, Limits memory limits) {
        stablecoin = stablecoin_;
        goldFeed = goldFeed_;
        maxExitFeeBps = limits.maxExitFeeBps;
        minBondBps = limits.minBondBps;
        maxPriceAge = limits.maxPriceAge;
    }

    /// @notice Open a scheme with the caller as its jeweller.
    function openScheme(string calldata shopName, TolaScheme.Terms calldata terms) external returns (address scheme) {
        if (terms.exitFeeBps > maxExitFeeBps || terms.bondBps < minBondBps || terms.maxPriceAge > maxPriceAge) {
            revert TermsOutsideLimits();
        }
        scheme = address(new TolaScheme(stablecoin, goldFeed, msg.sender, shopName, terms));
        _schemes.push(scheme);
        _schemesOf[msg.sender].push(scheme);
        emit SchemeOpened(scheme, msg.sender, shopName);
    }

    function schemeCount() external view returns (uint256) {
        return _schemes.length;
    }

    function schemes() external view returns (address[] memory) {
        return _schemes;
    }

    function schemesOf(address jeweller) external view returns (address[] memory) {
        return _schemesOf[jeweller];
    }
}
