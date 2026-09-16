// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {NetworkVersion} from "../src/NetworkVersion.sol";

contract NetworkVersionTest is Test {
    NetworkVersion internal nv;

    function setUp() public {
        nv = new NetworkVersion();
    }

    function test_version() public view {
        assertEq(nv.VERSION(), "0.0.0-phase0");
    }

    function test_chainIdFollowsTheVm() public {
        vm.chainId(1337);
        assertEq(nv.chainId(), 1337);
        vm.chainId(31_648_428);
        assertEq(nv.chainId(), 31_648_428);
    }
}
