// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title DvPSettlement
/// @notice Atomic delivery-versus-payment / payment-versus-payment (blueprint section 10, Milestone F).
///         Two parties each sign the same EIP-712 `Settlement` (asset legs, counterparties, deadline, nonce);
///         anyone (the settlement agent) submits both signatures and both legs move in one transaction or
///         none does. Parties pre-approve this contract for their leg (an EIP-2612 permit can be bundled by
///         the submitter through `settleWithPermits`). Signatures are checked with ERC-1271, so passkey
///         accounts and multisigs are first-class. Each settlement id can execute once; either party can
///         cancel before execution.
contract DvPSettlement is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Leg {
        address from;
        address to;
        IERC20 token;
        uint256 amount;
    }

    struct Settlement {
        Leg legA; // delivery (asset) or payment leg of party A
        Leg legB; // payment leg of party B
        uint256 deadline;
        bytes32 nonce; // product settlement id; unique per pair of parties
    }

    bytes32 private constant LEG_TYPEHASH =
        keccak256("Leg(address from,address to,address token,uint256 amount)");
    bytes32 private constant SETTLEMENT_TYPEHASH = keccak256(
        "Settlement(Leg legA,Leg legB,uint256 deadline,bytes32 nonce)Leg(address from,address to,address token,uint256 amount)"
    );

    mapping(bytes32 => bool) public executed;
    mapping(bytes32 => bool) public cancelled;

    event Settled(
        bytes32 indexed id, address indexed partyA, address indexed partyB, Leg legA, Leg legB
    );
    event Cancelled(bytes32 indexed id, address by);

    error Expired();
    error AlreadyExecuted();
    error IsCancelled();
    error BadSignature(address party);
    error NotParty();
    error LegMismatch();

    constructor() EIP712("DvPSettlement", "1") {}

    function hashLeg(Leg memory leg) public pure returns (bytes32) {
        return keccak256(abi.encode(LEG_TYPEHASH, leg.from, leg.to, address(leg.token), leg.amount));
    }

    function settlementId(Settlement memory s) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SETTLEMENT_TYPEHASH, hashLeg(s.legA), hashLeg(s.legB), s.deadline, s.nonce
                )
            )
        );
    }

    /// @notice Execute both legs atomically. `sigA` is party A's (legA.from) signature, `sigB` party B's.
    function settle(Settlement calldata s, bytes calldata sigA, bytes calldata sigB)
        public
        nonReentrant
        returns (bytes32 id)
    {
        if (block.timestamp > s.deadline) revert Expired();
        if (s.legA.to != s.legB.from || s.legB.to != s.legA.from) revert LegMismatch();
        id = settlementId(s);
        if (executed[id]) revert AlreadyExecuted();
        if (cancelled[id]) revert IsCancelled();
        if (!SignatureChecker.isValidSignatureNow(s.legA.from, id, sigA)) {
            revert BadSignature(s.legA.from);
        }
        if (!SignatureChecker.isValidSignatureNow(s.legB.from, id, sigB)) {
            revert BadSignature(s.legB.from);
        }
        executed[id] = true;
        s.legA.token.safeTransferFrom(s.legA.from, s.legA.to, s.legA.amount);
        s.legB.token.safeTransferFrom(s.legB.from, s.legB.to, s.legB.amount);
        emit Settled(id, s.legA.from, s.legB.from, s.legA, s.legB);
    }

    /// @notice Same, with EIP-2612 permits (bytes signatures, ERC-1271 aware) applied first so no prior approval is needed.
    function settleWithPermits(
        Settlement calldata s,
        bytes calldata sigA,
        bytes calldata sigB,
        bytes calldata permitA,
        bytes calldata permitB
    ) external returns (bytes32 id) {
        if (permitA.length > 0) _permit(s.legA, permitA);
        if (permitB.length > 0) _permit(s.legB, permitB);
        return settle(s, sigA, sigB);
    }

    function cancel(Settlement calldata s) external {
        if (msg.sender != s.legA.from && msg.sender != s.legB.from) revert NotParty();
        bytes32 id = settlementId(s);
        if (executed[id]) revert AlreadyExecuted();
        cancelled[id] = true;
        emit Cancelled(id, msg.sender);
    }

    function _permit(Leg calldata leg, bytes calldata sig) private {
        // permit(owner, spender, value, deadline, bytes signature) — USDC v2.2 / TestStablecoin overload.
        (bool ok,) = address(leg.token)
            .call(
                abi.encodeWithSignature(
                    "permit(address,address,uint256,uint256,bytes)",
                    leg.from,
                    address(this),
                    leg.amount,
                    type(uint256).max,
                    sig
                )
            );
        ok; // a failed permit is not fatal: an existing allowance may already cover the leg; transferFrom decides
    }
}
