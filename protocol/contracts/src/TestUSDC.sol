// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TestUSDC
/// @notice Local-devnet stand-in for USDC (ADR-0007). 6 decimals like Circle's USDC, EIP-2612 permit so
///         paymaster and Gateway-style flows can be exercised, owner-mintable so tests can fund accounts.
///         NOT Circle-issued and never deployed beyond a devnet: the shared devnet uses bridged Sepolia
///         USDC and production uses native USDC once Circle supports the chain.
contract TestUSDC is ERC20, ERC20Permit, Ownable {
    uint8 private constant DECIMALS = 6;

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

    /// @notice Burn from the caller (mirrors USDC's holder-side burn).
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
