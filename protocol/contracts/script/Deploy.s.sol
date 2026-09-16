// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {NetworkVersion} from "../src/NetworkVersion.sol";

/// @dev forge script script/Deploy.s.sol --rpc-url l2_devnet --broadcast --private-key $DEPLOYER_KEY
contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        NetworkVersion nv = new NetworkVersion();
        vm.stopBroadcast();
        console.log("NetworkVersion deployed at", address(nv), "on chain", block.chainid);
    }
}
