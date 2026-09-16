// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {VenuePair} from "./VenuePair.sol";

/// @title VenueFactory
/// @notice UniswapV2-compatible factory (`createPair`, `getPair`, `allPairs`). Pairs are CREATE2 so the pair address
///         is predictable from the two tokens, which Metapad's LaunchToken relies on to block pre-graduation transfers.
contract VenueFactory {
    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;
    address public feeTo; // reserved: no protocol fee today (V2 interface compatibility)
    address public feeToSetter;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint256);

    error IdenticalAddresses();
    error ZeroAddress();
    error PairExists();
    error Forbidden();

    constructor(address _feeToSetter) {
        feeToSetter = _feeToSetter;
    }

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    function sortTokens(address tokenA, address tokenB)
        public
        pure
        returns (address token0, address token1)
    {
        if (tokenA == tokenB) revert IdenticalAddresses();
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert ZeroAddress();
    }

    function pairFor(address tokenA, address tokenB) external view returns (address) {
        (address token0, address token1) = sortTokens(tokenA, tokenB);
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff),
                            address(this),
                            keccak256(abi.encodePacked(token0, token1)),
                            keccak256(type(VenuePair).creationCode)
                        )
                    )
                )
            )
        );
    }

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        (address token0, address token1) = sortTokens(tokenA, tokenB);
        if (getPair[token0][token1] != address(0)) revert PairExists();
        pair = address(new VenuePair{salt: keccak256(abi.encodePacked(token0, token1))}());
        VenuePair(pair).initialize(token0, token1);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function setFeeToSetter(address next) external {
        if (msg.sender != feeToSetter) revert Forbidden();
        feeToSetter = next;
    }
}
