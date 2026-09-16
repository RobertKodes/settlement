// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {NetworkVersion} from "../src/NetworkVersion.sol";
import {TestUSDC, TestEURC} from "../src/TestUSDC.sol";
import {StableSwapPool} from "../src/dex/StableSwapPool.sol";
import {DvPSettlement} from "../src/settlement/DvPSettlement.sol";
import {VenueFactory} from "../src/venue/VenueFactory.sol";
import {VenueRouter} from "../src/venue/VenueRouter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Devnet-only bundle: NetworkVersion + TestUSDC (minted to the deployer). Run through
///      `make devnet-deploy`, which records the addresses in chain/lineth/deployments.local.json.
contract DeployDevnet is Script {
    function run() external {
        uint256 key = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(key);
        vm.startBroadcast(key);
        NetworkVersion nv = new NetworkVersion();
        TestUSDC usdc = new TestUSDC(deployer);
        TestEURC eurc = new TestEURC(deployer);
        usdc.mint(deployer, 1_000_000_000 * 1e6); // 1 billion test USDC
        eurc.mint(deployer, 1_000_000_000 * 1e6);
        // USDC/EURC StableSwap seeded with 5M/5M (A=200, fee 0.04%) so `swap` intents have native liquidity.
        StableSwapPool pool = new StableSwapPool(
            IERC20(address(usdc)), IERC20(address(eurc)), 6, 6, 200, 4_000_000, deployer
        );
        usdc.approve(address(pool), 5_000_000e6);
        eurc.approve(address(pool), 5_000_000e6);
        pool.addLiquidity([uint256(5_000_000e6), uint256(5_000_000e6)], 0, type(uint256).max);
        DvPSettlement dvp = new DvPSettlement();
        // The venue (UniswapV2-compatible) with a seeded USDC/EURC pair, so graduation and V2 routing can be exercised locally.
        VenueFactory venue = new VenueFactory(deployer);
        VenueRouter venueRouter = new VenueRouter(venue);
        usdc.approve(address(venueRouter), 1_000_000e6);
        eurc.approve(address(venueRouter), 1_000_000e6);
        venueRouter.addLiquidity(
            address(usdc),
            address(eurc),
            1_000_000e6,
            1_000_000e6,
            0,
            0,
            deployer,
            type(uint256).max
        );
        vm.stopBroadcast();
        console.log("VenueFactory", address(venue));
        console.log("VenueRouter", address(venueRouter));
        console.log("DvPSettlement", address(dvp));
        console.log("NetworkVersion", address(nv));
        console.log("TestUSDC", address(usdc));
        console.log("TestEURC", address(eurc));
        console.log("StableSwapPool", address(pool));
        console.log("chainId", block.chainid);
    }
}
