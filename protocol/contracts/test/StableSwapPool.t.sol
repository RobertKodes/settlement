// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TestUSDC, TestEURC} from "../src/TestUSDC.sol";
import {StableSwapPool} from "../src/dex/StableSwapPool.sol";

contract StableSwapPoolTest is Test {
    TestUSDC internal usdc;
    TestEURC internal eurc;
    StableSwapPool internal pool;
    address internal owner = makeAddr("owner");
    address internal lp = makeAddr("lp");
    address internal trader = makeAddr("trader");
    uint256 internal constant DL = type(uint256).max;

    function setUp() public {
        usdc = new TestUSDC(owner);
        eurc = new TestEURC(owner);
        pool = new StableSwapPool(
            IERC20(address(usdc)), IERC20(address(eurc)), 6, 6, 200, 4_000_000, owner
        ); // A=200, fee 0.04%
        vm.startPrank(owner);
        usdc.mint(lp, 10_000_000e6);
        eurc.mint(lp, 10_000_000e6);
        usdc.mint(trader, 1_000_000e6);
        eurc.mint(trader, 1_000_000e6);
        vm.stopPrank();
        vm.startPrank(lp);
        usdc.approve(address(pool), type(uint256).max);
        eurc.approve(address(pool), type(uint256).max);
        pool.addLiquidity([uint256(1_000_000e6), uint256(1_000_000e6)], 0, DL);
        vm.stopPrank();
        vm.startPrank(trader);
        usdc.approve(address(pool), type(uint256).max);
        eurc.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function test_balancedPoolQuotesNearOneToOne() public view {
        (uint256 dy, uint256 feeAmt) = pool.getDy(0, 1, 10_000e6);
        assertGt(dy, 9990e6, "stable pair should quote close to 1:1");
        assertLt(dy, 10_000e6, "never more than input");
        assertApproxEqRel(feeAmt, 4e6, 0.01e18, "fee is 0.04% of ~10k out"); // 0.04% of 10,000 = 4 EURC
    }

    function test_exchangeMovesTokensAndKeepsInvariant() public {
        uint256 dBefore = pool.getD();
        uint256 vpBefore = pool.getVirtualPrice();
        vm.prank(trader);
        uint256 dy = pool.exchange(0, 1, 100_000e6, 99_000e6, trader, DL);
        assertEq(eurc.balanceOf(trader), 1_000_000e6 + dy);
        assertEq(usdc.balanceOf(trader), 900_000e6);
        assertGe(pool.getD(), dBefore, "fees grow D");
        assertGe(pool.getVirtualPrice(), vpBefore, "LP value never drops on a trade");
    }

    function test_slippageAndDeadlineProtect() public {
        vm.startPrank(trader);
        vm.expectRevert();
        pool.exchange(0, 1, 100_000e6, 100_000e6, trader, DL);
        vm.expectRevert(StableSwapPool.Deadline.selector);
        pool.exchange(0, 1, 1e6, 0, trader, block.timestamp - 1);
        vm.stopPrank();
    }

    function test_removeLiquidityRoundTrip() public {
        uint256 lpBal = pool.balanceOf(lp);
        vm.prank(lp);
        uint256[2] memory out = pool.removeLiquidity(lpBal, [uint256(0), uint256(0)], DL);
        assertEq(out[0], 1_000_000e6);
        assertEq(out[1], 1_000_000e6);
        assertEq(pool.totalSupply(), 0);
    }

    function testFuzz_noFreeMoneyRoundTrip(uint96 amountIn) public {
        uint256 dx = bound(uint256(amountIn), 1e6, 500_000e6);
        vm.startPrank(trader);
        uint256 dy = pool.exchange(0, 1, dx, 0, trader, DL);
        uint256 back = pool.exchange(1, 0, dy, 0, trader, DL);
        vm.stopPrank();
        assertLe(back, dx, "round trip can never profit");
    }

    function testFuzz_virtualPriceMonotone(uint96 a, uint96 b) public {
        uint256 vp0 = pool.getVirtualPrice();
        vm.startPrank(trader);
        pool.exchange(0, 1, bound(uint256(a), 1e6, 300_000e6), 0, trader, DL);
        pool.exchange(1, 0, bound(uint256(b), 1e6, 300_000e6), 0, trader, DL);
        vm.stopPrank();
        assertGe(pool.getVirtualPrice(), vp0);
    }

    function test_governanceBounds() public {
        vm.startPrank(owner);
        vm.expectRevert(StableSwapPool.FeeTooHigh.selector);
        pool.setFee(1e8 + 1);
        vm.expectRevert(StableSwapPool.InvalidA.selector);
        pool.setA(1000); // > 2x jump
        pool.setA(300);
        assertEq(pool.A(), 300 * 100);
        vm.stopPrank();
    }
}
