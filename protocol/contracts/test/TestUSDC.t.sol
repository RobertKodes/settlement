// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {TestUSDC} from "../src/TestUSDC.sol";

contract TestUSDCTest is Test {
    TestUSDC internal usdc;
    address internal owner = makeAddr("owner");
    uint256 internal holderKey = 0xA11CE;
    address internal holder;

    function setUp() public {
        holder = vm.addr(holderKey);
        usdc = new TestUSDC(owner);
    }

    function test_sixDecimals() public view {
        assertEq(usdc.decimals(), 6);
        assertEq(usdc.symbol(), "USDC");
    }

    function test_onlyOwnerMints() public {
        vm.prank(owner);
        usdc.mint(holder, 1_000_000);
        assertEq(usdc.balanceOf(holder), 1_000_000);
        vm.expectRevert();
        usdc.mint(holder, 1);
    }

    function test_permitApprovesWithoutGasFromHolder() public {
        vm.prank(owner);
        usdc.mint(holder, 5_000_000);
        address spender = makeAddr("paymaster");
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
                ),
                holder,
                spender,
                2_000_000,
                usdc.nonces(holder),
                deadline
            )
        );
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(holderKey, digest);
        // A third party (relayer) submits the permit; the holder signed offline.
        usdc.permit(holder, spender, 2_000_000, deadline, v, r, s);
        assertEq(usdc.allowance(holder, spender), 2_000_000);
        vm.prank(spender);
        usdc.transferFrom(holder, spender, 2_000_000);
        assertEq(usdc.balanceOf(spender), 2_000_000);
    }

    function testFuzz_burnReducesSupply(uint128 amount) public {
        vm.prank(owner);
        usdc.mint(holder, amount);
        vm.prank(holder);
        usdc.burn(amount);
        assertEq(usdc.totalSupply(), 0);
    }
}
