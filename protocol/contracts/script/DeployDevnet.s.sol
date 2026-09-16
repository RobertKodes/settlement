// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {NetworkVersion} from "../src/NetworkVersion.sol";
import {TestUSDC} from "../src/TestUSDC.sol";

/// @dev Devnet-only bundle: NetworkVersion + TestUSDC (minted to the deployer). Run through
///      `make devnet-deploy`, which records the addresses in chain/lineth/deployments.local.json.
contract DeployDevnet is Script {
    function run() external {
        uint256 key = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(key);
        vm.startBroadcast(key);
        NetworkVersion nv = new NetworkVersion();
        TestUSDC usdc = new TestUSDC(deployer);
        usdc.mint(deployer, 1_000_000_000 * 1e6); // 1 billion test USDC
        vm.stopBroadcast();
        console.log("NetworkVersion", address(nv));
        console.log("TestUSDC", address(usdc));
        console.log("chainId", block.chainid);
    }
}
