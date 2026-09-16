// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint as OZIEntryPoint} from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";
import {PasskeyAccountFactory} from "../src/account/PasskeyAccountFactory.sol";
import {VenueFactory} from "../src/venue/VenueFactory.sol";
import {VenueRouter} from "../src/venue/VenueRouter.sol";
import {DvPSettlement} from "../src/settlement/DvPSettlement.sol";

/// Deploys the platform's contracts on a chain where USDC already exists (Arc): the venue Metapad graduates into,
/// the account layer (EntryPoint v0.8 + passkey factory; no paymaster, Arc gas is USDC) and DvP settlement.
/// Env: DEPLOYER_KEY, QUOTE_TOKEN (USDC address on that chain), SOLIDITY_P256 (true where RIP-7212 is absent).
contract DeployVenue is Script {
    function run() external {
        uint256 key = vm.envUint("DEPLOYER_KEY");
        address quote = vm.envAddress("QUOTE_TOKEN");
        bool solidityP256 = vm.envOr("SOLIDITY_P256", true);
        vm.startBroadcast(key);
        VenueFactory factory = new VenueFactory(vm.addr(key));
        VenueRouter router = new VenueRouter(factory);
        EntryPoint entryPoint = new EntryPoint();
        PasskeyAccountFactory accounts =
            new PasskeyAccountFactory(OZIEntryPoint(address(entryPoint)), solidityP256);
        DvPSettlement dvp = new DvPSettlement();
        vm.stopBroadcast();
        console.log("VenueFactory", address(factory));
        console.log("VenueRouter", address(router));
        console.log("EntryPoint", address(entryPoint));
        console.log("PasskeyAccountFactory", address(accounts));
        console.log("DvPSettlement", address(dvp));
        console.log("quoteToken", quote);
        console.log("chainId", block.chainid);
    }
}
