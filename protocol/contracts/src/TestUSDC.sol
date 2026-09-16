// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title TestUSDC
/// @notice Local-devnet stand-in for USDC (ADR-0007). 6 decimals like Circle's USDC, EIP-2612 permit so
///         paymaster and Gateway-style flows can be exercised, owner-mintable so tests can fund accounts.
///         NOT Circle-issued and never deployed beyond a devnet: the shared devnet uses bridged Sepolia
///         USDC and production uses native USDC once Circle supports the chain.
contract TestUSDC is ERC20, ERC20Permit, Ownable {
    uint8 private constant DECIMALS = 6;
    // Same type hash OpenZeppelin uses (theirs is private).
    bytes32 private constant PERMIT_TYPEHASH = keccak256(
        "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
    );

    constructor(address initialOwner)
        ERC20("USD Coin (devnet test)", "USDC")
        ERC20Permit("USD Coin (devnet test)")
        Ownable(initialOwner)
    {}

    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    /// @notice Mint base units (1 USDC = 1_000_000). Owner only.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice EIP-2612 permit with a `bytes` signature, accepted from smart-contract wallets through ERC-1271.
    ///         Mirrors USDC v2.2's overload so the paymaster and Gateway-style flows work for contract accounts.
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (block.timestamp > deadline) revert ERC2612ExpiredSignature(deadline);
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, owner, spender, value, _useNonce(owner), deadline)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        if (!SignatureChecker.isValidSignatureNow(owner, digest, signature)) {
            revert ERC2612InvalidSigner(address(0), owner);
        }
        _approve(owner, spender, value);
    }

    /// @notice Burn from the caller (mirrors USDC's holder-side burn).
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
