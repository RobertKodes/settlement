// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TestUSDC, TestEURC} from "../src/TestUSDC.sol";
import {DvPSettlement} from "../src/settlement/DvPSettlement.sol";

contract DvPSettlementTest is Test {
    TestUSDC internal usdc;
    TestEURC internal asset; // stands in for a tokenized asset in the DvP case
    DvPSettlement internal dvp;
    address internal owner = makeAddr("owner");
    uint256 internal aKey = 0xA;
    uint256 internal bKey = 0xB;
    address internal a;
    address internal b;
    address internal agent = makeAddr("settlement-agent");

    function setUp() public {
        a = vm.addr(aKey);
        b = vm.addr(bKey);
        usdc = new TestUSDC(owner);
        asset = new TestEURC(owner);
        dvp = new DvPSettlement();
        vm.startPrank(owner);
        asset.mint(a, 1000e6); // A delivers 1000 units of the asset
        usdc.mint(b, 5_000_000e6); // B pays 5M USDC
        vm.stopPrank();
    }

    function _settlement(uint256 price) internal view returns (DvPSettlement.Settlement memory s) {
        s.legA = DvPSettlement.Leg({from: a, to: b, token: IERC20(address(asset)), amount: 1000e6});
        s.legB = DvPSettlement.Leg({from: b, to: a, token: IERC20(address(usdc)), amount: price});
        s.deadline = block.timestamp + 1 days;
        s.nonce = keccak256("stl_0001");
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _permitSig(uint256 key, TestUSDC token, address ownerAddr, uint256 value)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
                ),
                ownerAddr,
                address(dvp),
                value,
                token.nonces(ownerAddr),
                type(uint256).max
            )
        );
        return
            _sign(
                key, keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash))
            );
    }

    function test_atomicDvPWithPermits() public {
        DvPSettlement.Settlement memory s = _settlement(5_000_000e6);
        bytes32 id = dvp.settlementId(s);
        bytes memory permitA = _permitSig(aKey, TestUSDC(address(asset)), a, 1000e6);
        bytes memory permitB = _permitSig(bKey, usdc, b, 5_000_000e6);
        vm.prank(agent);
        dvp.settleWithPermits(s, _sign(aKey, id), _sign(bKey, id), permitA, permitB);
        assertEq(asset.balanceOf(b), 1000e6, "asset delivered to B");
        assertEq(usdc.balanceOf(a), 5_000_000e6, "payment received by A");
        assertTrue(dvp.executed(id));
    }

    function test_nothingMovesWhenOneLegFails() public {
        DvPSettlement.Settlement memory s = _settlement(5_000_000e6);
        bytes32 id = dvp.settlementId(s);
        bytes memory permitA = _permitSig(aKey, TestUSDC(address(asset)), a, 1000e6);
        // B never approves: B's leg reverts, so A's delivery must be rolled back too.
        vm.prank(agent);
        vm.expectRevert();
        dvp.settleWithPermits(s, _sign(aKey, id), _sign(bKey, id), permitA, "");
        assertEq(asset.balanceOf(b), 0);
        assertEq(asset.balanceOf(a), 1000e6);
        assertFalse(dvp.executed(id));
    }

    function test_rejectsWrongSignerReplayAndCancel() public {
        DvPSettlement.Settlement memory s = _settlement(5_000_000e6);
        bytes32 id = dvp.settlementId(s);
        vm.prank(a);
        asset.approve(address(dvp), type(uint256).max);
        vm.prank(b);
        usdc.approve(address(dvp), type(uint256).max);
        // signatures are computed before expectRevert: vm.sign is itself a call and would consume it
        bytes memory sigA = _sign(aKey, id);
        bytes memory sigB = _sign(bKey, id);
        bytes memory sigWrong = _sign(0xC, id);
        vm.expectRevert(abi.encodeWithSelector(DvPSettlement.BadSignature.selector, b));
        dvp.settle(s, sigA, sigWrong);
        dvp.settle(s, sigA, sigB);
        vm.expectRevert(DvPSettlement.AlreadyExecuted.selector);
        dvp.settle(s, sigA, sigB);
        DvPSettlement.Settlement memory s2 = _settlement(4_900_000e6);
        s2.nonce = keccak256("stl_0002");
        bytes32 id2 = dvp.settlementId(s2);
        bytes memory sigA2 = _sign(aKey, id2);
        bytes memory sigB2 = _sign(bKey, id2);
        vm.prank(b);
        dvp.cancel(s2);
        vm.expectRevert(DvPSettlement.IsCancelled.selector);
        dvp.settle(s2, sigA2, sigB2);
    }

    function test_legsMustMirrorParties() public {
        DvPSettlement.Settlement memory s = _settlement(1e6);
        s.legB.to = agent; // payment sent elsewhere
        vm.expectRevert(DvPSettlement.LegMismatch.selector);
        dvp.settle(s, "", "");
    }
}
