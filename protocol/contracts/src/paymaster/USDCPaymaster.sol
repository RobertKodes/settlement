// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {BasePaymaster} from "account-abstraction/core/BasePaymaster.sol";
import {UserOperationLib} from "account-abstraction/core/UserOperationLib.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IERC20PermitBytes {
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        bytes calldata signature
    ) external;
}

/// @title USDCPaymaster
/// @notice ERC-4337 v0.8 paymaster that charges gas in USDC (ADR-0006). Wire format and flow mirror
///         Circle Paymaster so switching to Circle's contract is a configuration change once the network is
///         supported:
///
///         paymasterAndData = paymaster(20) ‖ verificationGasLimit(16) ‖ postOpGasLimit(16)
///                            ‖ mode(1) = 0x00 ‖ token(20) ‖ permitAmount(32) ‖ permitSignature(bytes)
///
///         Validation consumes an EIP-2612 permit (ERC-1271 for contract accounts, ECDSA for EOAs) granting
///         this paymaster `permitAmount`, pulls the maximum token cost up front, and `_postOp` refunds the
///         difference to the sender. Price is a devnet stub set by the owner (`tokenPerEth`, token base units
///         per 1 ETH); production takes it from the OracleAdapter (ADR-0020).
contract USDCPaymaster is BasePaymaster {
    using SafeERC20 for IERC20;
    using UserOperationLib for PackedUserOperation;

    uint256 private constant MODE_OFFSET = UserOperationLib.PAYMASTER_DATA_OFFSET; // 52
    uint256 private constant TOKEN_OFFSET = MODE_OFFSET + 1; // 53
    uint256 private constant AMOUNT_OFFSET = TOKEN_OFFSET + 20; // 73
    uint256 private constant SIG_OFFSET = AMOUNT_OFFSET + 32; // 105
    uint256 private constant PERMIT_DEADLINE = type(uint256).max;
    /// @dev Gas charged for `_postOp` itself, added to the actual cost so the paymaster never runs at a loss.
    uint256 public constant POST_OP_GAS = 45_000;

    IERC20 public immutable TOKEN;
    /// @notice Token base units per 1 ETH (e.g. 4_000e6 = 4000 USDC/ETH). Devnet stub.
    uint256 public tokenPerEth;

    event UserOperationSponsored(
        address indexed sender,
        bytes32 indexed userOpHash,
        uint256 tokenPerEth,
        uint256 prefundToken,
        uint256 actualToken
    );
    event PriceUpdated(uint256 tokenPerEth);

    error UnsupportedMode(uint8 mode);
    error UnsupportedToken(address token);
    error PermitAmountTooLow(uint256 required, uint256 permitted);
    error InvalidPaymasterData(uint256 length);

    constructor(IEntryPoint entryPoint_, IERC20 token_, uint256 tokenPerEth_)
        BasePaymaster(entryPoint_)
    {
        TOKEN = token_;
        tokenPerEth = tokenPerEth_;
    }

    function setTokenPerEth(uint256 tokenPerEth_) external onlyOwner {
        tokenPerEth = tokenPerEth_;
        emit PriceUpdated(tokenPerEth_);
    }

    /// @notice Withdraw collected fees.
    function withdrawToken(address to, uint256 amount) external onlyOwner {
        TOKEN.safeTransfer(to, amount);
    }

    /// @notice Token cost of `weiAmount` at the current price, rounded up.
    function tokenAmount(uint256 weiAmount) public view returns (uint256) {
        return (weiAmount * tokenPerEth + 1e18 - 1) / 1e18;
    }

    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) internal override returns (bytes memory context, uint256 validationData) {
        bytes calldata data = userOp.paymasterAndData;
        if (data.length < SIG_OFFSET) revert InvalidPaymasterData(data.length);
        uint8 mode = uint8(data[MODE_OFFSET]);
        if (mode != 0) revert UnsupportedMode(mode);
        address token = address(bytes20(data[TOKEN_OFFSET:AMOUNT_OFFSET]));
        if (token != address(TOKEN)) revert UnsupportedToken(token);
        uint256 permitAmount = uint256(bytes32(data[AMOUNT_OFFSET:SIG_OFFSET]));
        bytes calldata permitSig = data[SIG_OFFSET:];

        uint256 prefund = tokenAmount(maxCost);
        if (permitAmount < prefund) revert PermitAmountTooLow(prefund, permitAmount);

        // A replayed permit (same nonce) reverts inside the token; if the allowance is already in place the
        // transferFrom below still succeeds, so the operation is not blocked by an earlier partial run.
        try IERC20PermitBytes(address(TOKEN))
            .permit(userOp.sender, address(this), permitAmount, PERMIT_DEADLINE, permitSig) {}
            catch {}
        TOKEN.safeTransferFrom(userOp.sender, address(this), prefund);

        context = abi.encode(userOp.sender, userOpHash, prefund, tokenPerEth);
        validationData = 0; // valid, no time bounds
    }

    function _postOp(
        PostOpMode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) internal override {
        (address sender, bytes32 userOpHash, uint256 prefund, uint256 price) =
            abi.decode(context, (address, bytes32, uint256, uint256));
        uint256 actualWei = actualGasCost + POST_OP_GAS * actualUserOpFeePerGas;
        uint256 actual = (actualWei * price + 1e18 - 1) / 1e18;
        if (actual > prefund) actual = prefund; // never charge more than what was permitted and pulled
        if (prefund > actual) TOKEN.safeTransfer(sender, prefund - actual);
        emit UserOperationSponsored(sender, userOpHash, price, prefund, actual);
    }
}
