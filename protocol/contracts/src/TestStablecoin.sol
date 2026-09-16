// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title TestStablecoin
/// @notice Devnet stand-in for a Circle stablecoin (ADR-0007): 6 decimals, EIP-2612 permit including the
///         `bytes`-signature overload USDC v2.2 exposes (ERC-1271 aware), owner-mintable. NOT Circle-issued.
contract TestStablecoin is ERC20, ERC20Permit, Ownable {
    uint8 private constant DECIMALS = 6;
    bytes32 private constant PERMIT_TYPEHASH = keccak256(
        "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
    );

    constructor(string memory name_, string memory symbol_, address initialOwner)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
        Ownable(initialOwner)
    {}

    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

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

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
