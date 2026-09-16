// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {IEntryPoint as OZIEntryPoint} from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC7821} from "@openzeppelin/contracts/interfaces/draft-IERC7821.sol";
import {Execution} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {TestUSDC} from "../src/TestUSDC.sol";
import {PasskeyAccount} from "../src/account/PasskeyAccount.sol";
import {PasskeyAccountFactory} from "../src/account/PasskeyAccountFactory.sol";
import {USDCPaymaster} from "../src/paymaster/USDCPaymaster.sol";

/// Milestone C (blueprint section 39): create smart account -> fund with test USDC -> send -> pay the fee
/// without user-managed ETH. The test plays bundler (calls handleOps directly).
contract MilestoneCTest is Test {
    uint256 internal constant P256_N =
        0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551;
    uint256 internal constant PASSKEY_PRIV = 0x5eedc0ffee;

    EntryPoint internal entryPoint;
    TestUSDC internal usdc;
    PasskeyAccountFactory internal factory;
    USDCPaymaster internal paymaster;
    address internal owner = makeAddr("owner");
    address internal bundler = makeAddr("bundler");
    address internal merchant = makeAddr("merchant");
    bytes32 internal qx;
    bytes32 internal qy;
    address internal account;

    function setUp() public {
        entryPoint = new EntryPoint();
        usdc = new TestUSDC(owner);
        factory = new PasskeyAccountFactory(OZIEntryPoint(address(entryPoint)), true);
        vm.prank(owner);
        paymaster =
            new USDCPaymaster(IEntryPoint(address(entryPoint)), IERC20(address(usdc)), 4000e6);
        vm.deal(owner, 10 ether);
        vm.prank(owner);
        paymaster.deposit{value: 5 ether}();

        (uint256 x, uint256 y) = vm.publicKeyP256(PASSKEY_PRIV);
        (qx, qy) = (bytes32(x), bytes32(y));
        account = factory.getAddress(qx, qy, bytes32(0));
        vm.prank(owner);
        usdc.mint(account, 1000e6); // 1000 USDC, and deliberately zero ETH
    }

    function _signP256(bytes32 digest) internal returns (bytes memory) {
        (bytes32 r, bytes32 s) = vm.signP256(PASSKEY_PRIV, digest);
        if (uint256(s) > P256_N / 2) s = bytes32(P256_N - uint256(s)); // low-s, as OZ P256.verify requires
        return abi.encodePacked(r, s);
    }

    function _permitDigest(uint256 amount) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
                ),
                account,
                address(paymaster),
                amount,
                usdc.nonces(account),
                type(uint256).max
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
    }

    function _buildOp(bytes memory callData, bytes memory initCode, uint256 permitAmount)
        internal
        returns (PackedUserOperation memory op)
    {
        uint128 verificationGas = 1_200_000; // P-256 in Solidity ~330k, plus clone init on first op
        uint128 callGas = 200_000;
        uint128 pmVerificationGas = 900_000; // permit (P-256 via ERC-1271) + transferFrom
        uint128 pmPostOpGas = 60_000;
        uint256 maxFee = 1 gwei;
        bytes memory permitSig = _signP256(_permitDigest(permitAmount));
        op = PackedUserOperation({
            sender: account,
            nonce: entryPoint.getNonce(account, 0),
            initCode: initCode,
            callData: callData,
            accountGasLimits: bytes32((uint256(verificationGas) << 128) | callGas),
            preVerificationGas: 60_000,
            gasFees: bytes32((uint256(maxFee) << 128) | maxFee),
            paymasterAndData: abi.encodePacked(
                address(paymaster),
                pmVerificationGas,
                pmPostOpGas,
                uint8(0),
                address(usdc),
                permitAmount,
                permitSig
            ),
            signature: ""
        });
        op.signature = _signP256(entryPoint.getUserOpHash(op));
    }

    /// ERC-7821 supports batch mode only: mode = 0x01 (CALLTYPE_BATCH) ‖ 0x00 (EXECTYPE_DEFAULT) ‖ zeros.
    bytes32 internal constant MODE_BATCH = bytes32(uint256(0x01) << 248);

    function _transferCall(address to, uint256 amount) internal view returns (bytes memory) {
        Execution[] memory batch = new Execution[](1);
        batch[0] = Execution({
            target: address(usdc), value: 0, callData: abi.encodeCall(IERC20.transfer, (to, amount))
        });
        return abi.encodeCall(IERC7821.execute, (MODE_BATCH, abi.encode(batch)));
    }

    function test_milestoneC_createFundSendPayFeeInUSDC() public {
        bytes memory initCode = abi.encodePacked(
            address(factory),
            abi.encodeCall(PasskeyAccountFactory.createAccount, (qx, qy, bytes32(0)))
        );
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = _buildOp(_transferCall(merchant, 250e6), initCode, 50e6);

        assertEq(account.code.length, 0, "account is counterfactual before the first op");
        assertEq(account.balance, 0, "account holds no ETH");

        vm.prank(bundler);
        entryPoint.handleOps(ops, payable(bundler));

        assertGt(account.code.length, 0, "account deployed by initCode");
        assertEq(usdc.balanceOf(merchant), 250e6, "merchant paid");
        uint256 fee = 1000e6 - 250e6 - usdc.balanceOf(account);
        assertGt(fee, 0, "fee charged in USDC");
        assertLt(fee, 50e6, "fee below the permitted maximum, remainder refunded");
        assertEq(usdc.balanceOf(address(paymaster)), fee, "paymaster holds exactly the fee");
        assertEq(account.balance, 0, "still no ETH needed");
        console.log("USDC fee for create+transfer (base units):", fee);
    }

    function test_secondOpReusesAccountAndChargesLess() public {
        bytes memory initCode = abi.encodePacked(
            address(factory),
            abi.encodeCall(PasskeyAccountFactory.createAccount, (qx, qy, bytes32(0)))
        );
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = _buildOp(_transferCall(merchant, 1e6), initCode, 50e6);
        entryPoint.handleOps(ops, payable(bundler));
        uint256 afterFirst = usdc.balanceOf(account);

        ops[0] = _buildOp(_transferCall(merchant, 1e6), "", 50e6);
        entryPoint.handleOps(ops, payable(bundler));
        uint256 feeSecond = afterFirst - 1e6 - usdc.balanceOf(account);
        uint256 feeFirst = 1000e6 - 1e6 - afterFirst;
        assertLt(feeSecond, feeFirst, "no clone deployment on the second op");
        assertEq(usdc.balanceOf(merchant), 2e6);
    }

    function test_precompileProbePathAlsoWorks() public {
        PasskeyAccountFactory probing =
            new PasskeyAccountFactory(OZIEntryPoint(address(entryPoint)), false);
        address acct = address(probing.createAccount(qx, qy, bytes32(0)));
        bytes32 digest = keccak256("hello");
        bytes memory sig = _signP256(digest);
        assertEq(PasskeyAccount(payable(acct)).isValidSignature(digest, sig), bytes4(0x1626ba7e));
    }

    function test_rejectsWrongPasskey() public {
        bytes memory initCode = abi.encodePacked(
            address(factory),
            abi.encodeCall(PasskeyAccountFactory.createAccount, (qx, qy, bytes32(0)))
        );
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = _buildOp(_transferCall(merchant, 1e6), initCode, 50e6);
        (bytes32 r, bytes32 s) = vm.signP256(0xbad, entryPoint.getUserOpHash(ops[0]));
        if (uint256(s) > P256_N / 2) s = bytes32(P256_N - uint256(s));
        ops[0].signature = abi.encodePacked(r, s);
        vm.expectRevert(); // AA24 signature error
        entryPoint.handleOps(ops, payable(bundler));
    }

    function test_rejectsPermitBelowMaxCost() public {
        bytes memory initCode = abi.encodePacked(
            address(factory),
            abi.encodeCall(PasskeyAccountFactory.createAccount, (qx, qy, bytes32(0)))
        );
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = _buildOp(_transferCall(merchant, 1e6), initCode, 1); // permit 0.000001 USDC
        vm.expectRevert(); // AA33 reverted: PermitAmountTooLow
        entryPoint.handleOps(ops, payable(bundler));
    }
}
