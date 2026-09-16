// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Account} from "@openzeppelin/contracts/account/Account.sol";
import {ERC7821} from "@openzeppelin/contracts/account/extensions/draft-ERC7821.sol";
import {IEntryPoint} from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {SignerP256} from "@openzeppelin/contracts/utils/cryptography/signers/SignerP256.sol";
import {
    AbstractSigner
} from "@openzeppelin/contracts/utils/cryptography/signers/AbstractSigner.sol";
import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

/// @title PasskeyAccount
/// @notice Milestone C smart account (ADR-0008): ERC-4337 (EntryPoint v0.8) account whose only signer is a
///         P-256 public key, i.e. a passkey's key pair. Signatures are `r ‖ s` (64 bytes) over the v0.8
///         typed-data user-op hash. Execution follows ERC-7821 (single or batch), so the entry point and the
///         account itself are the only authorized executors. ERC-1271 is exposed so EIP-2612 permits and
///         other typed-data approvals can be signed by the passkey (needed by the USDC paymaster).
///
///         Deliberately minimal: no modules yet. ERC-6900 modularity (policies, session keys, recovery) is
///         layered in the next slice; the WebAuthn envelope (authenticatorData/clientDataJSON) is handled by
///         the signer library once the browser flow exists — today the hash is signed raw.
///         On chains without the RIP-7212 precompile (this devnet), OpenZeppelin's P256 falls back to
///         Solidity verification (~330k gas per signature). Deployed as minimal-proxy clones.
contract PasskeyAccount is
    Account,
    SignerP256,
    ERC7821,
    IERC1271,
    Initializable,
    ERC721Holder,
    ERC1155Holder
{
    IEntryPoint private immutable _ENTRY_POINT;
    /// @notice True on chains without the RIP-7212 precompile: verify in pure Solidity, never probe `0x100`.
    ///         (The probe is also what Foundry's fork simulation refuses: "call to non-contract address".)
    bool public immutable SOLIDITY_P256;

    // secp256r1 generator point: a valid key for the implementation contract, which is never used directly.
    bytes32 private constant GX =
        0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296;
    bytes32 private constant GY =
        0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5;

    constructor(IEntryPoint entryPoint_, bool solidityP256) SignerP256(GX, GY) {
        _ENTRY_POINT = entryPoint_;
        SOLIDITY_P256 = solidityP256;
        _disableInitializers();
    }

    /// @notice Bind the clone to its passkey public key. Called once by the factory.
    function initialize(bytes32 qx, bytes32 qy) external initializer {
        _setSigner(qx, qy);
    }

    function entryPoint() public view override returns (IEntryPoint) {
        return _ENTRY_POINT;
    }

    /// @notice ERC-1271: the passkey signs `hash` directly. Replay across accounts is prevented by the
    ///         per-account key; production adds ERC-7739 defensive rehashing (open item in ADR-0008).
    function isValidSignature(bytes32 hash, bytes calldata signature)
        external
        view
        override
        returns (bytes4)
    {
        return _rawSignatureValidation(hash, signature)
            ? IERC1271.isValidSignature.selector
            : bytes4(0xffffffff);
    }

    function _rawSignatureValidation(bytes32 hash, bytes calldata signature)
        internal
        view
        override(AbstractSigner, SignerP256)
        returns (bool)
    {
        if (signature.length < 0x40) return false;
        bytes32 r = bytes32(signature[0x00:0x20]);
        bytes32 s = bytes32(signature[0x20:0x40]);
        (bytes32 qx, bytes32 qy) = signer();
        return
            SOLIDITY_P256
                ? P256.verifySolidity(hash, r, s, qx, qy)
                : P256.verify(hash, r, s, qx, qy);
    }

    function _erc7821AuthorizedExecutor(address caller, bytes32 mode, bytes calldata executionData)
        internal
        view
        override
        returns (bool)
    {
        return caller == address(entryPoint())
            || super._erc7821AuthorizedExecutor(caller, mode, executionData);
    }
}
