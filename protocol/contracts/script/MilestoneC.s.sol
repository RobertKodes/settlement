// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {IEntryPoint as OZIEntryPoint} from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC7821} from "@openzeppelin/contracts/interfaces/draft-IERC7821.sol";
import {Execution} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {TestUSDC} from "../src/TestUSDC.sol";
import {PasskeyAccountFactory} from "../src/account/PasskeyAccountFactory.sol";
import {USDCPaymaster} from "../src/paymaster/USDCPaymaster.sol";

/// Milestone C on a live network: deploy EntryPoint v0.8 + PasskeyAccountFactory + USDCPaymaster, then
/// create a passkey account through initCode, pay a merchant in TestUSDC and settle the gas fee in USDC.
/// The deployer EOA plays bundler. Run through `make devnet-milestone-c`.
contract MilestoneC is Script {
    uint256 internal constant P256_N =
        0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551;
    bytes32 internal constant MODE_BATCH = bytes32(uint256(0x01) << 248);

    function run() external {
        uint256 key = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(key);
        TestUSDC usdc = TestUSDC(vm.envAddress("TEST_USDC"));
        uint256 passkeyPriv = vm.envOr("PASSKEY_PRIV", uint256(0x5eedc0ffee)); // devnet-only demo key
        address merchant = vm.envOr("MERCHANT", address(0x000000000000000000000000000000000000bEEF));

        vm.startBroadcast(key);
        EntryPoint entryPoint = new EntryPoint();
        PasskeyAccountFactory factory = new PasskeyAccountFactory(
            OZIEntryPoint(address(entryPoint)), vm.envOr("SOLIDITY_P256", true)
        );
        USDCPaymaster paymaster =
            new USDCPaymaster(IEntryPoint(address(entryPoint)), IERC20(address(usdc)), 4000e6);
        paymaster.deposit{value: 1 ether}();
        (uint256 x, uint256 y) = vm.publicKeyP256(passkeyPriv);
        address account = factory.getAddress(bytes32(x), bytes32(y), bytes32(0));
        usdc.mint(account, 1000e6);
        vm.stopBroadcast();

        PackedUserOperation memory op = _buildOp(
            entryPoint,
            usdc,
            paymaster,
            account,
            bytes32(x),
            bytes32(y),
            factory,
            merchant,
            passkeyPriv
        );
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        uint256 merchantBefore = usdc.balanceOf(merchant);

        vm.startBroadcast(key);
        entryPoint.handleOps(ops, payable(deployer));
        vm.stopBroadcast();

        uint256 fee = 1000e6 - 250e6 - usdc.balanceOf(account);
        console.log("EntryPoint          ", address(entryPoint));
        console.log("PasskeyAccountFactory", address(factory));
        console.log("USDCPaymaster       ", address(paymaster));
        console.log("PasskeyAccount      ", account);
        console.log("account ETH balance ", account.balance);
        console.log("merchant USDC delta ", usdc.balanceOf(merchant) - merchantBefore);
        console.log("fee paid in USDC    ", fee);
        require(usdc.balanceOf(merchant) - merchantBefore == 250e6, "merchant not paid");
        require(account.balance == 0, "account should hold no ETH");
        require(fee > 0 && fee < 50e6, "fee outside expected band");
        string memory json = string.concat(
            '{"EntryPoint":"',
            vm.toString(address(entryPoint)),
            '","PasskeyAccountFactory":"',
            vm.toString(address(factory)),
            '","USDCPaymaster":"',
            vm.toString(address(paymaster)),
            '","PasskeyAccount":"',
            vm.toString(account),
            '","feeUsdcBaseUnits":',
            vm.toString(fee),
            "}"
        );
        vm.writeFile("out/milestone-c.json", json);
    }

    function _buildOp(
        EntryPoint entryPoint,
        TestUSDC usdc,
        USDCPaymaster paymaster,
        address account,
        bytes32 qx,
        bytes32 qy,
        PasskeyAccountFactory factory,
        address merchant,
        uint256 passkeyPriv
    ) internal returns (PackedUserOperation memory op) {
        uint256 permitAmount = 50e6;
        bytes32 permitStruct = keccak256(
            abi.encode(
                keccak256(
                    "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
                ),
                account,
                address(paymaster),
                permitAmount,
                usdc.nonces(account),
                type(uint256).max
            )
        );
        bytes memory permitSig = _sign(
            passkeyPriv,
            keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), permitStruct))
        );
        Execution[] memory batch = new Execution[](1);
        batch[0] = Execution({
            target: address(usdc),
            value: 0,
            callData: abi.encodeCall(IERC20.transfer, (merchant, 250e6))
        });
        bytes memory initCode = account.code.length == 0
            ? abi.encodePacked(
                address(factory),
                abi.encodeCall(PasskeyAccountFactory.createAccount, (qx, qy, bytes32(0)))
            )
            : bytes("");
        uint256 maxFee = 2 gwei;
        op = PackedUserOperation({
            sender: account,
            nonce: entryPoint.getNonce(account, 0),
            initCode: initCode,
            callData: abi.encodeCall(IERC7821.execute, (MODE_BATCH, abi.encode(batch))),
            accountGasLimits: bytes32((uint256(1_200_000) << 128) | 200_000),
            preVerificationGas: 60_000,
            gasFees: bytes32((uint256(maxFee) << 128) | maxFee),
            paymasterAndData: abi.encodePacked(
                address(paymaster),
                uint128(900_000),
                uint128(60_000),
                uint8(0),
                address(usdc),
                permitAmount,
                permitSig
            ),
            signature: ""
        });
        op.signature = _sign(passkeyPriv, entryPoint.getUserOpHash(op));
    }

    function _sign(uint256 priv, bytes32 digest) internal returns (bytes memory) {
        (bytes32 r, bytes32 s) = vm.signP256(priv, digest);
        if (uint256(s) > P256_N / 2) s = bytes32(P256_N - uint256(s));
        return abi.encodePacked(r, s);
    }
}
