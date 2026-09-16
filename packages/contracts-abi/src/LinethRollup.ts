// Hand-written subset of the Lineth L1 rollup contract (LinethRollupV8) we read for finality.
export const linethRollupAbi = [
  {
    type: "function",
    name: "currentL2BlockNumber",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
] as const;
