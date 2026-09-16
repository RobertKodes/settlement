// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TestUSDC, TestEURC} from "../src/TestUSDC.sol";
import {VenueFactory} from "../src/venue/VenueFactory.sol";
import {VenuePair} from "../src/venue/VenuePair.sol";
import {VenueRouter} from "../src/venue/VenueRouter.sol";

/// The venue Metapad graduates into: a launch token (EURC stands in) paired against USDC.
contract VenueTest is Test {
    TestUSDC internal usdc;
    TestEURC internal tkn;
    VenueFactory internal factory;
    VenueRouter internal router;
    address internal owner = makeAddr("owner");
    address internal migrator = makeAddr("metapad-migrator");
    address internal trader = makeAddr("trader");
    uint256 internal constant DL = type(uint256).max;

    function setUp() public {
        usdc = new TestUSDC(owner);
        tkn = new TestEURC(owner);
        factory = new VenueFactory(owner);
        router = new VenueRouter(factory);
        vm.startPrank(owner);
        usdc.mint(migrator, 50_000e6);
        tkn.mint(migrator, 200_000_000e6);
        usdc.mint(trader, 100_000e6);
        vm.stopPrank();
    }

    /// Graduation the way Metapad's UniswapV2Migrator does it: createPair, transfer both sides, mint LP to 0xdead.
    function test_graduationMintsLockedLiquidity() public {
        vm.startPrank(migrator);
        address pair = factory.createPair(address(tkn), address(usdc));
        assertEq(
            pair, factory.pairFor(address(tkn), address(usdc)), "CREATE2 address is predictable"
        );
        tkn.transfer(pair, 200_000_000e6);
        usdc.transfer(pair, 50_000e6);
        uint256 lp = VenuePair(pair).mint(address(0xdead));
        vm.stopPrank();
        assertGt(lp, 0);
        assertEq(
            VenuePair(pair).balanceOf(address(0xdead)), lp + VenuePair(pair).MINIMUM_LIQUIDITY()
        );
        (uint112 r0, uint112 r1,) = VenuePair(pair).getReserves();
        assertEq(uint256(r0) * r1, 200_000_000e6 * 50_000e6);
    }

    function _graduate() internal returns (address pair) {
        vm.startPrank(migrator);
        pair = factory.createPair(address(tkn), address(usdc));
        tkn.transfer(pair, 200_000_000e6);
        usdc.transfer(pair, 50_000e6);
        VenuePair(pair).mint(address(0xdead));
        vm.stopPrank();
    }

    function test_swapThroughRouterRespectsQuoteAndMinOut() public {
        _graduate();
        address[] memory path = new address[](2);
        path[0] = address(usdc);
        path[1] = address(tkn);
        uint256[] memory q = router.getAmountsOut(1000e6, path);
        vm.startPrank(trader);
        usdc.approve(address(router), type(uint256).max);
        vm.expectRevert(VenueRouter.InsufficientOutput.selector);
        router.swapExactTokensForTokens(1000e6, q[1] + 1, path, trader, DL);
        uint256[] memory out = router.swapExactTokensForTokens(1000e6, q[1], path, trader, DL);
        vm.stopPrank();
        assertEq(out[1], q[1]);
        assertEq(tkn.balanceOf(trader), q[1]);
    }

    function testFuzz_roundTripNeverProfits(uint96 amt) public {
        _graduate();
        uint256 amountIn = bound(uint256(amt), 1e6, 20_000e6);
        address[] memory buy = new address[](2);
        buy[0] = address(usdc);
        buy[1] = address(tkn);
        address[] memory sell = new address[](2);
        sell[0] = address(tkn);
        sell[1] = address(usdc);
        vm.startPrank(trader);
        usdc.approve(address(router), type(uint256).max);
        tkn.approve(address(router), type(uint256).max);
        uint256 got = router.swapExactTokensForTokens(amountIn, 0, buy, trader, DL)[1];
        uint256 back = router.swapExactTokensForTokens(got, 0, sell, trader, DL)[1];
        vm.stopPrank();
        assertLe(back, amountIn);
    }

    function testFuzz_kNeverDecreases(uint96 a, uint96 b) public {
        address pair = _graduate();
        (uint112 r0, uint112 r1,) = VenuePair(pair).getReserves();
        uint256 k0 = uint256(r0) * r1;
        address[] memory buy = new address[](2);
        buy[0] = address(usdc);
        buy[1] = address(tkn);
        address[] memory sell = new address[](2);
        sell[0] = address(tkn);
        sell[1] = address(usdc);
        vm.startPrank(trader);
        usdc.approve(address(router), type(uint256).max);
        tkn.approve(address(router), type(uint256).max);
        router.swapExactTokensForTokens(bound(uint256(a), 1e6, 30_000e6), 0, buy, trader, DL);
        uint256 have = tkn.balanceOf(trader);
        router.swapExactTokensForTokens(bound(uint256(b), 1e6, have), 0, sell, trader, DL); // dust sells legitimately revert with zero output
        vm.stopPrank();
        (r0, r1,) = VenuePair(pair).getReserves();
        assertGe(uint256(r0) * r1, k0);
    }

    function test_addAndRemoveLiquidityViaRouter() public {
        _graduate();
        vm.startPrank(migrator);
        usdc.approve(address(router), type(uint256).max);
        tkn.approve(address(router), type(uint256).max);
        // migrator has nothing left; mint it more as an LP
        vm.stopPrank();
        vm.startPrank(owner);
        usdc.mint(migrator, 5000e6);
        tkn.mint(migrator, 20_000_000e6);
        vm.stopPrank();
        vm.startPrank(migrator);
        (uint256 aA, uint256 aB, uint256 lp) = router.addLiquidity(
            address(tkn), address(usdc), 20_000_000e6, 5000e6, 0, 0, migrator, DL
        );
        assertGt(lp, 0);
        address pair = factory.getPair(address(tkn), address(usdc));
        IERC20(pair).approve(address(router), lp);
        (uint256 bA, uint256 bB) =
            router.removeLiquidity(address(tkn), address(usdc), lp, 0, 0, migrator, DL);
        vm.stopPrank();
        assertApproxEqRel(bA, aA, 0.001e18);
        assertApproxEqRel(bB, aB, 0.001e18);
    }
}
