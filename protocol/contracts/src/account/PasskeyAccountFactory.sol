// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IEntryPoint} from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";
import {PasskeyAccount} from "./PasskeyAccount.sol";

/// @title PasskeyAccountFactory
/// @notice Counterfactual passkey accounts: the address is a pure function of (qx, qy, salt), so a user can
///         receive funds before the account exists and the first user operation can carry the `initCode`.
contract PasskeyAccountFactory {
    PasskeyAccount public immutable IMPLEMENTATION;

    event AccountCreated(address indexed account, bytes32 qx, bytes32 qy, bytes32 salt);

    /// @param solidityP256 true where RIP-7212 is unavailable (this devnet); see PasskeyAccount.SOLIDITY_P256.
    constructor(IEntryPoint entryPoint, bool solidityP256) {
        IMPLEMENTATION = new PasskeyAccount(entryPoint, solidityP256);
    }

    function getAddress(bytes32 qx, bytes32 qy, bytes32 salt) public view returns (address) {
        return Clones.predictDeterministicAddress(
            address(IMPLEMENTATION), _salt(qx, qy, salt), address(this)
        );
    }

    /// @notice Idempotent: returns the existing account if it was already created (EntryPoint initCode semantics).
    function createAccount(bytes32 qx, bytes32 qy, bytes32 salt)
        external
        returns (PasskeyAccount account)
    {
        address predicted = getAddress(qx, qy, salt);
        if (predicted.code.length > 0) return PasskeyAccount(payable(predicted));
        account = PasskeyAccount(
            payable(Clones.cloneDeterministic(address(IMPLEMENTATION), _salt(qx, qy, salt)))
        );
        account.initialize(qx, qy);
        emit AccountCreated(address(account), qx, qy, salt);
    }

    function _salt(bytes32 qx, bytes32 qy, bytes32 salt) private pure returns (bytes32) {
        return keccak256(abi.encode(qx, qy, salt));
    }
}
