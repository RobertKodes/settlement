import type { FastifyInstance } from "fastify";
import { createPublicClient, http } from "viem";

export interface ChainProbe {
  name: string;
  rpcUrl: string;
  expectedChainId: number;
}

/** GET /v1/health: process liveness plus chain reachability (chain ID and head block per RPC). */
export function registerHealthRoutes(app: FastifyInstance, probes: ChainProbe[]): void {
  app.get("/v1/health", async () => {
    const chains = await Promise.all(
      probes.map(async (p) => {
        try {
          const client = createPublicClient({ transport: http(p.rpcUrl, { timeout: 3_000 }) });
          const [chainId, block] = await Promise.all([
            client.getChainId(),
            client.getBlockNumber(),
          ]);
          return {
            name: p.name,
            ok: chainId === p.expectedChainId,
            chainId,
            block: block.toString(),
          };
        } catch (e) {
          return { name: p.name, ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
    return {
      status: chains.every((c) => c.ok) ? "ok" : "degraded",
      chains,
      at: new Date().toISOString(),
    };
  });
}
