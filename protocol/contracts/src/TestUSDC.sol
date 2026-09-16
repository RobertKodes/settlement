// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {TestStablecoin} from "./TestStablecoin.sol";

/// @notice Devnet USDC stand-in (ADR-0007). See TestStablecoin.
contract TestUSDC is TestStablecoin {
    constructor(address initialOwner)
        TestStablecoin("USD Coin (devnet test)", "USDC", initialOwner)
    {}
}

/// @notice Devnet EURC stand-in.
contract TestEURC is TestStablecoin {
    constructor(address initialOwner) TestStablecoin("EURC (devnet test)", "EURC", initialOwner) {}
}
