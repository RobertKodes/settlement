// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title StableSwapPool
/// @notice Two-asset StableSwap (Curve invariant, ADR-0011) for correlated assets such as USDC/EURC.
///         Balances are normalised to 18 decimals through per-token rate multipliers; the LP token is this
///         contract. The invariant: A·n^n·Σx + D = A·n^n·D + D^(n+1)/(n^n·Πx), solved by Newton iteration.
///         Protections (blueprint section 9): deadline and minimum output on every trade, fee bounds,
///         reentrancy guard, no admin key over user funds (only `fee` and `A` ramp are owner-settable, both bounded).
contract StableSwapPool is ERC20, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    uint256 private constant N = 2;
    uint256 private constant A_PRECISION = 100;
    uint256 private constant MAX_A = 10_000 * A_PRECISION;
    uint256 private constant FEE_DENOMINATOR = 1e10;
    uint256 public constant MAX_FEE = 1e8; // 1%
    uint256 private constant PRECISION = 1e18;

    IERC20[2] public tokens;
    uint256[2] public rates; // multiplier to 18 decimals (1e12 for a 6-decimal token)
    uint256[2] public balances; // normalised
    uint256 public A; // amplification × A_PRECISION
    uint256 public fee; // per FEE_DENOMINATOR, charged on the output

    event TokenExchange(
        address indexed buyer,
        uint256 soldId,
        uint256 tokensSold,
        uint256 boughtId,
        uint256 tokensBought,
        uint256 fee
    );
    event AddLiquidity(
        address indexed provider, uint256[2] amounts, uint256 invariant, uint256 lpMinted
    );
    event RemoveLiquidity(address indexed provider, uint256[2] amounts, uint256 lpBurned);
    event FeeUpdated(uint256 fee);
    event AmplificationUpdated(uint256 A);

    error Deadline();
    error Slippage(uint256 got, uint256 want);
    error SameToken();
    error FeeTooHigh();
    error InvalidA();
    error ZeroAmount();

    constructor(
        IERC20 token0,
        IERC20 token1,
        uint8 dec0,
        uint8 dec1,
        uint256 a,
        uint256 fee_,
        address owner_
    ) ERC20("Settlement StableSwap LP", "SSLP") Ownable(owner_) {
        if (address(token0) == address(token1)) revert SameToken();
        if (a == 0 || a * A_PRECISION > MAX_A) revert InvalidA();
        if (fee_ > MAX_FEE) revert FeeTooHigh();
        tokens = [token0, token1];
        rates = [10 ** (18 - dec0), 10 ** (18 - dec1)];
        A = a * A_PRECISION;
        fee = fee_;
    }

    // ------------------------------------------------------------------ invariant math

    function _getD(uint256[2] memory xp, uint256 amp) internal pure returns (uint256 d) {
        uint256 s = xp[0] + xp[1];
        if (s == 0) return 0;
        d = s;
        uint256 ann = amp * N; // A·n (A already carries n^(n-1) per Curve's convention)
        for (uint256 i = 0; i < 255; i++) {
            uint256 dP = d;
            dP = (dP * d) / (xp[0] * N);
            dP = (dP * d) / (xp[1] * N);
            uint256 dPrev = d;
            d = ((ann * s) / A_PRECISION + dP * N) * d
                / (((ann - A_PRECISION) * d) / A_PRECISION + (N + 1) * dP);
            if (d > dPrev ? d - dPrev <= 1 : dPrev - d <= 1) return d;
        }
        revert("D did not converge");
    }

    /// @dev Balance of coin j after coin i's balance becomes x, holding D constant.
    function _getY(uint256 i, uint256 x, uint256[2] memory xp, uint256 amp)
        internal
        pure
        returns (uint256 y)
    {
        uint256 d = _getD(xp, amp);
        uint256 ann = amp * N;
        uint256 c = d;
        c = (c * d) / (x * N); // only the "other" coin (i) enters the product
        c = (c * d * A_PRECISION) / (ann * N);
        uint256 b = x + (d * A_PRECISION) / ann;
        y = d;
        for (uint256 k = 0; k < 255; k++) {
            uint256 yPrev = y;
            y = (y * y + c) / (2 * y + b - d);
            if (y > yPrev ? y - yPrev <= 1 : yPrev - y <= 1) return y;
        }
        revert("y did not converge");
    }

    function _xp() internal view returns (uint256[2] memory xp) {
        xp = [balances[0], balances[1]];
    }

    function getD() external view returns (uint256) {
        return _getD(_xp(), A);
    }

    /// @notice LP token value in 18-decimal units; must never decrease through trading.
    function getVirtualPrice() external view returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? 0 : (_getD(_xp(), A) * PRECISION) / supply;
    }

    // ------------------------------------------------------------------ quotes and trades

    /// @notice Output of selling `dx` of token i for token j, after fees. Token units, not normalised.
    function getDy(uint256 i, uint256 j, uint256 dx)
        public
        view
        returns (uint256 dy, uint256 dyFee)
    {
        if (i == j || i > 1 || j > 1) revert SameToken();
        uint256[2] memory xp = _xp();
        uint256 x = xp[i] + dx * rates[i];
        uint256 y = _getY(j, x, xp, A);
        uint256 dyNorm = xp[j] - y - 1; // -1: round against the trader
        uint256 feeNorm = (dyNorm * fee) / FEE_DENOMINATOR;
        dy = (dyNorm - feeNorm) / rates[j];
        dyFee = feeNorm / rates[j];
    }

    function exchange(uint256 i, uint256 j, uint256 dx, uint256 minDy, address to, uint256 deadline)
        external
        nonReentrant
        returns (uint256 dy)
    {
        if (block.timestamp > deadline) revert Deadline();
        if (dx == 0) revert ZeroAmount();
        uint256 dyFee;
        (dy, dyFee) = getDy(i, j, dx);
        if (dy < minDy) revert Slippage(dy, minDy);
        balances[i] += dx * rates[i];
        balances[j] -= (dy + dyFee) * rates[j];
        // the fee stays in the pool for LPs: add it back to balances[j]
        balances[j] += dyFee * rates[j];
        tokens[i].safeTransferFrom(msg.sender, address(this), dx);
        tokens[j].safeTransfer(to, dy);
        emit TokenExchange(msg.sender, i, dx, j, dy, dyFee);
    }

    // ------------------------------------------------------------------ liquidity

    function addLiquidity(uint256[2] calldata amounts, uint256 minMint, uint256 deadline)
        external
        nonReentrant
        returns (uint256 minted)
    {
        if (block.timestamp > deadline) revert Deadline();
        uint256 supply = totalSupply();
        uint256[2] memory xp = _xp();
        uint256 d0 = supply == 0 ? 0 : _getD(xp, A);
        for (uint256 k = 0; k < N; k++) {
            if (supply == 0 && amounts[k] == 0) revert ZeroAmount(); // first deposit must seed both sides
            if (amounts[k] > 0) tokens[k].safeTransferFrom(msg.sender, address(this), amounts[k]);
            xp[k] += amounts[k] * rates[k];
        }
        uint256 d1 = _getD(xp, A);
        if (d1 <= d0) revert ZeroAmount();
        // Imbalanced deposits are charged the swap fee on the imbalance (standard Curve behaviour, simplified:
        // fee on the difference between the ideal and the actual balance of each coin).
        if (supply > 0) {
            uint256 imbalanceFee = (fee * N) / (4 * (N - 1));
            for (uint256 k = 0; k < N; k++) {
                uint256 ideal = (d1 * balances[k]) / d0;
                uint256 diff = ideal > xp[k] ? ideal - xp[k] : xp[k] - ideal;
                xp[k] -= (imbalanceFee * diff) / FEE_DENOMINATOR;
            }
            uint256 d2 = _getD(xp, A);
            minted = (supply * (d2 - d0)) / d0;
        } else {
            minted = d1;
        }
        if (minted < minMint) revert Slippage(minted, minMint);
        balances = [xp[0], xp[1]];
        _mint(msg.sender, minted);
        emit AddLiquidity(msg.sender, [amounts[0], amounts[1]], d1, minted);
    }

    function removeLiquidity(uint256 lpAmount, uint256[2] calldata minAmounts, uint256 deadline)
        external
        nonReentrant
        returns (uint256[2] memory amounts)
    {
        if (block.timestamp > deadline) revert Deadline();
        uint256 supply = totalSupply();
        for (uint256 k = 0; k < N; k++) {
            uint256 norm = (balances[k] * lpAmount) / supply;
            amounts[k] = norm / rates[k];
            if (amounts[k] < minAmounts[k]) revert Slippage(amounts[k], minAmounts[k]);
            balances[k] -= norm;
            tokens[k].safeTransfer(msg.sender, amounts[k]);
        }
        _burn(msg.sender, lpAmount);
        emit RemoveLiquidity(msg.sender, [amounts[0], amounts[1]], lpAmount);
    }

    // ------------------------------------------------------------------ bounded governance

    function setFee(uint256 fee_) external onlyOwner {
        if (fee_ > MAX_FEE) revert FeeTooHigh();
        fee = fee_;
        emit FeeUpdated(fee_);
    }

    /// @notice A can only move by at most 2x per call; ramping over time is a Phase 3 refinement.
    function setA(uint256 a) external onlyOwner {
        uint256 next = a * A_PRECISION;
        if (a == 0 || next > MAX_A || next > A * 2 || next < A / 2) revert InvalidA();
        A = next;
        emit AmplificationUpdated(next);
    }
}
