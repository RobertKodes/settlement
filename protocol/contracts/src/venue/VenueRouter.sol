// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {VenueFactory} from "./VenueFactory.sol";
import {VenuePair} from "./VenuePair.sol";

/// @title VenueRouter
/// @notice The subset of UniswapV2 Router02 the platform and Metapad need: add/remove liquidity, exact-in swaps
///         along a path, and the read-only `getAmountsOut`/`getAmountsIn`. Deadline and minimum-out on every call.
contract VenueRouter {
    using SafeERC20 for IERC20;

    VenueFactory public immutable factory;

    error Expired();
    error InsufficientOutput();
    error InsufficientAAmount();
    error InsufficientBAmount();
    error InvalidPath();

    modifier ensure(uint256 deadline) {
        if (block.timestamp > deadline) revert Expired();
        _;
    }

    constructor(VenueFactory _factory) {
        factory = _factory;
    }

    // ------------------------------------------------------------------ liquidity

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        address pair = factory.getPair(tokenA, tokenB);
        if (pair == address(0)) pair = factory.createPair(tokenA, tokenB);
        (uint256 reserveA, uint256 reserveB) = _reserves(pair, tokenA);
        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint256 amountBOptimal = quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                if (amountBOptimal < amountBMin) revert InsufficientBAmount();
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint256 amountAOptimal = quote(amountBDesired, reserveB, reserveA);
                if (amountAOptimal < amountAMin) revert InsufficientAAmount();
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }
        IERC20(tokenA).safeTransferFrom(msg.sender, pair, amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, pair, amountB);
        liquidity = VenuePair(pair).mint(to);
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 amountA, uint256 amountB) {
        address pair = factory.getPair(tokenA, tokenB);
        IERC20(pair).safeTransferFrom(msg.sender, pair, liquidity);
        (uint256 amount0, uint256 amount1) = VenuePair(pair).burn(to);
        (address token0,) = factory.sortTokens(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);
        if (amountA < amountAMin) revert InsufficientAAmount();
        if (amountB < amountBMin) revert InsufficientBAmount();
    }

    // ------------------------------------------------------------------ swaps

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256[] memory amounts) {
        amounts = getAmountsOut(amountIn, path);
        if (amounts[amounts.length - 1] < amountOutMin) revert InsufficientOutput();
        IERC20(path[0]).safeTransferFrom(msg.sender, factory.getPair(path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
    }

    function _swap(uint256[] memory amounts, address[] calldata path, address to) private {
        for (uint256 i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = factory.sortTokens(input, output);
            uint256 amountOut = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) =
                input == token0 ? (uint256(0), amountOut) : (amountOut, uint256(0));
            address recipient = i < path.length - 2 ? factory.getPair(output, path[i + 2]) : to;
            VenuePair(factory.getPair(input, output))
                .swap(amount0Out, amount1Out, recipient, new bytes(0));
        }
    }

    // ------------------------------------------------------------------ views

    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB)
        public
        pure
        returns (uint256)
    {
        return (amountA * reserveB) / reserveA;
    }

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        public
        pure
        returns (uint256)
    {
        uint256 amountInWithFee = amountIn * 997;
        return (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
    }

    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut)
        public
        pure
        returns (uint256)
    {
        return (reserveIn * amountOut * 1000) / ((reserveOut - amountOut) * 997) + 1;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        public
        view
        returns (uint256[] memory amounts)
    {
        if (path.length < 2) revert InvalidPath();
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i; i < path.length - 1; i++) {
            (uint256 reserveIn, uint256 reserveOut) =
                _reserves(factory.getPair(path[i], path[i + 1]), path[i]);
            amounts[i + 1] = getAmountOut(amounts[i], reserveIn, reserveOut);
        }
    }

    function getAmountsIn(uint256 amountOut, address[] calldata path)
        public
        view
        returns (uint256[] memory amounts)
    {
        if (path.length < 2) revert InvalidPath();
        amounts = new uint256[](path.length);
        amounts[amounts.length - 1] = amountOut;
        for (uint256 i = path.length - 1; i > 0; i--) {
            (uint256 reserveIn, uint256 reserveOut) =
                _reserves(factory.getPair(path[i - 1], path[i]), path[i - 1]);
            amounts[i - 1] = getAmountIn(amounts[i], reserveIn, reserveOut);
        }
    }

    function _reserves(address pair, address tokenA)
        private
        view
        returns (uint256 reserveA, uint256 reserveB)
    {
        if (pair == address(0)) return (0, 0);
        (uint112 r0, uint112 r1,) = VenuePair(pair).getReserves();
        (reserveA, reserveB) = tokenA == VenuePair(pair).token0() ? (r0, r1) : (r1, r0);
    }
}
