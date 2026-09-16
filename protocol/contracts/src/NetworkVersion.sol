// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

/// @title NetworkVersion
/// @notice Placeholder deployed to prove the toolchain and the devnet end to end (Milestone A/D).
///         It is the first contract every environment gets, so `version()` doubles as a "which
///         protocol release is on this chain" probe for the control plane (blueprint section 20).
contract NetworkVersion {
    string public constant VERSION = "0.0.0-phase0";

    /// @notice Chain ID as seen by the EVM; compared against the config registry in tests.
    function chainId() external view returns (uint256) {
        return block.chainid;
    }
}
