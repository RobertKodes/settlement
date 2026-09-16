// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title VenuePair
/// @notice Constant-product pool with the UniswapV2 pair interface (`mint`, `burn`, `swap`, `getReserves`,
///         `token0/token1`, `sync`), so Metapad's `UniswapV2Migrator` can graduate a launch into it unchanged and
///         any V2 router/aggregator can trade it. This is the venue we own on Arc (quoted in USDC) and later on the
///         Lineth rollup. Fee 0.30% to LPs. Minimal by design: no price oracle accumulators, no protocol fee switch.
contract VenuePair is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    address public immutable factory;
    address public token0;
    address public token1;
    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private blockTimestampLast;

    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);

    error Forbidden();
    error InsufficientLiquidityMinted();
    error InsufficientLiquidityBurned();
    error InsufficientOutputAmount();
    error InsufficientLiquidity();
    error InvalidTo();
    error InsufficientInputAmount();
    error K();
    error Overflow();

    constructor() ERC20("Venue LP", "VLP") {
        factory = msg.sender;
    }

    function initialize(address _token0, address _token1) external {
        if (msg.sender != factory) revert Forbidden();
        token0 = _token0;
        token1 = _token1;
    }

    function getReserves()
        public
        view
        returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast)
    {
        return (reserve0, reserve1, blockTimestampLast);
    }

    function _update(uint256 balance0, uint256 balance1) private {
        if (balance0 > type(uint112).max || balance1 > type(uint112).max) revert Overflow();
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        blockTimestampLast = uint32(block.timestamp);
        emit Sync(reserve0, reserve1);
    }

    /// @notice Mint LP for tokens already transferred in (V2 convention: transfer, then call).
    function mint(address to) external nonReentrant returns (uint256 liquidity) {
        (uint112 _reserve0, uint112 _reserve1,) = getReserves();
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0 = balance0 - _reserve0;
        uint256 amount1 = balance1 - _reserve1;
        uint256 supply = totalSupply();
        if (supply == 0) {
            liquidity = Math.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            _mint(address(0xdead), MINIMUM_LIQUIDITY); // permanently locked
        } else {
            liquidity = Math.min((amount0 * supply) / _reserve0, (amount1 * supply) / _reserve1);
        }
        if (liquidity == 0) revert InsufficientLiquidityMinted();
        _mint(to, liquidity);
        _update(balance0, balance1);
        emit Mint(msg.sender, amount0, amount1);
    }

    /// @notice Burn LP already transferred in; sends both tokens pro rata to `to`.
    function burn(address to) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 liquidity = balanceOf(address(this));
        uint256 supply = totalSupply();
        amount0 = (liquidity * balance0) / supply;
        amount1 = (liquidity * balance1) / supply;
        if (amount0 == 0 || amount1 == 0) revert InsufficientLiquidityBurned();
        _burn(address(this), liquidity);
        IERC20(token0).safeTransfer(to, amount0);
        IERC20(token1).safeTransfer(to, amount1);
        _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)));
        emit Burn(msg.sender, amount0, amount1, to);
    }

    /// @notice V2 swap: optimistic transfer out, then the k check with a 0.30% fee on inputs. `data` is ignored (no flash swaps).
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata)
        external
        nonReentrant
    {
        if (amount0Out == 0 && amount1Out == 0) revert InsufficientOutputAmount();
        (uint112 _reserve0, uint112 _reserve1,) = getReserves();
        if (amount0Out >= _reserve0 || amount1Out >= _reserve1) revert InsufficientLiquidity();
        if (to == token0 || to == token1) revert InvalidTo();
        if (amount0Out > 0) IERC20(token0).safeTransfer(to, amount0Out);
        if (amount1Out > 0) IERC20(token1).safeTransfer(to, amount1Out);
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0In =
            balance0 > _reserve0 - amount0Out ? balance0 - (_reserve0 - amount0Out) : 0;
        uint256 amount1In =
            balance1 > _reserve1 - amount1Out ? balance1 - (_reserve1 - amount1Out) : 0;
        if (amount0In == 0 && amount1In == 0) revert InsufficientInputAmount();
        uint256 adjusted0 = balance0 * 1000 - amount0In * 3;
        uint256 adjusted1 = balance1 * 1000 - amount1In * 3;
        if (adjusted0 * adjusted1 < uint256(_reserve0) * _reserve1 * 1_000_000) revert K();
        _update(balance0, balance1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    function sync() external nonReentrant {
        _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)));
    }
}
