import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { publicClient } from "@settlement/chain";
import { CCTP_DOMAINS } from "@settlement/config";
import { ARC, ArcRpcAdapter } from "@settlement/integration-arc";
import type { PlannerConfig } from "@settlement/router";
import type { Address } from "viem";
import type { ChainDeps } from "./execution.js";

/**
 * Architecture v2: the systems the orchestration layer can reach. Lineth from the devnet deployment,
 * Arc from chain/deployments/arc-testnet.json (written by `make arc-deploy`) plus a live RPC, CCTP domains
 * for chains that have one (the Lineth rollup does not). Anything absent is reported as BLOCKED by the
 * planner rather than hidden.
 */
export interface Systems {
  lineth?: ChainDeps;
  arc?: { adapter: ArcRpcAdapter; deployments?: Record<string, Address>; stableFxApiKey: boolean };
  planner: PlannerConfig;
  blocked: string[];
}

export function loadSystems(
  repoRoot: string,
  lineth: ChainDeps | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Systems {
  const blocked: string[] = [];
  const arcFile = join(repoRoot, "chain", "deployments", "arc-testnet.json");
  const arcDeployments = existsSync(arcFile)
    ? (JSON.parse(readFileSync(arcFile, "utf8")) as { contracts: Record<string, Address> })
        .contracts
    : undefined;
  const arcEnabled = env.ARC_ENABLED !== "0";
  const arc = arcEnabled
    ? {
        adapter: new ArcRpcAdapter({
          network: "testnet",
          ...(env.ARC_RPC_URL ? { rpcUrl: env.ARC_RPC_URL } : {}),
          ...(arcDeployments?.VenueRouter ? { venueRouter: arcDeployments.VenueRouter } : {}),
        }),
        ...(arcDeployments ? { deployments: arcDeployments } : {}),
        stableFxApiKey: !!env.STABLEFX_API_KEY,
      }
    : undefined;
  if (!arcDeployments)
    blocked.push(
      "arc contracts not deployed (make arc-key, fund at faucet.circle.com, make arc-deploy)",
    );
  if (!env.STABLEFX_API_KEY) blocked.push("StableFX needs an institutional API key from Circle");
  blocked.push(
    "Lineth rollup has no CCTP domain (needs Circle support): Lineth<->Arc value moves are BLOCKED",
  );
  if (!env.BRIDGE_API_KEY)
    blocked.push("Bridge sandbox credentials missing: fiat uses the mock provider");

  const planner: PlannerConfig = {
    ...(lineth
      ? {
          lineth: {
            client: lineth.l2,
            ...(lineth.venueRouter
              ? {
                  venue: {
                    system: "lineth",
                    chainId: lineth.chainId ?? 1337,
                    venue: "lineth-venue",
                    router: lineth.venueRouter,
                    tokens: { USDC: lineth.usdc, ...(lineth.eurc ? { EURC: lineth.eurc } : {}) },
                    networkFeeBaseUnits: 4_000_000n,
                    latencySeconds: 3,
                  },
                }
              : {}),
            ...(lineth.pool
              ? { stableswap: { pool: lineth.pool, coins: { USDC: 0, EURC: 1 } } }
              : {}),
          },
        }
      : {}),
    ...(arc
      ? {
          arc: {
            client: arc.adapter.client,
            ...(arcDeployments?.VenueRouter
              ? {
                  venue: {
                    system: "arc",
                    chainId: ARC.testnet.chainId,
                    venue: "arc-venue",
                    router: arcDeployments.VenueRouter,
                    tokens: { USDC: ARC.testnet.usdc, EURC: ARC.testnet.eurc },
                    networkFeeBaseUnits: 50_000n,
                    latencySeconds: 2,
                  },
                }
              : {}),
            stableFxApiKey: arc.stableFxApiKey,
          },
        }
      : {}),
    cctp: {
      domains: {
        [ARC.testnet.chainId]: CCTP_DOMAINS.arc,
        84532: CCTP_DOMAINS.base,
        11155111: CCTP_DOMAINS.ethereum,
        59141: CCTP_DOMAINS.linea,
      },
    },
  };
  return { ...(lineth ? { lineth } : {}), ...(arc ? { arc } : {}), planner, blocked };
}

export { publicClient };
