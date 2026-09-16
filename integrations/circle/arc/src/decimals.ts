export const ARC_NATIVE_DECIMALS = 18;
export const ARC_ERC20_DECIMALS = 6;
const FACTOR = 10n ** BigInt(ARC_NATIVE_DECIMALS - ARC_ERC20_DECIMALS);

/** Native (18-dec) USDC -> ERC-20 (6-dec) units. Truncates dust; use `hasDust` to detect it. */
export function arcNativeToErc20Units(native: bigint): bigint {
  if (native < 0n) throw new RangeError("negative amount");
  return native / FACTOR;
}

export function arcErc20ToNativeUnits(erc20: bigint): bigint {
  if (erc20 < 0n) throw new RangeError("negative amount");
  return erc20 * FACTOR;
}

/** True when a native amount is not representable in 6 decimals without loss. */
export function hasDust(native: bigint): boolean {
  return native % FACTOR !== 0n;
}
