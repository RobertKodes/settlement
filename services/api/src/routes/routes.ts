import { planRoutes } from "@settlement/router";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errors } from "../errors.js";
import type { Systems } from "../systems.js";

const PlanSchema = z.object({
  assetIn: z.enum(["USDC", "EURC"]),
  assetOut: z.enum(["USDC", "EURC"]),
  amountIn: z.string().regex(/^\d+$/),
  fromChainId: z.number().int().positive(),
  toChainId: z.number().int().positive(),
  maxSlippageBps: z.number().int().min(0).max(1000).optional(),
});

/**
 * GET  /v1/systems           what the orchestration layer can reach and what is BLOCKED (Architecture v2 §7)
 * POST /v1/routes/plan       candidate plans across Lineth / Arc / CCTP with legs, scores and BLOCKED reasons
 */
export function registerRouteRoutes(app: FastifyInstance, deps: { systems?: Systems }): void {
  app.get("/v1/systems", async () => {
    const s = deps.systems;
    return {
      lineth: s?.lineth
        ? {
            chainId: s.lineth.chainId,
            entryPoint: s.lineth.entryPoint,
            dvp: s.lineth.dvp,
            venueRouter: s.lineth.venueRouter,
            pool: s.lineth.pool,
            cctpDomain: null,
          }
        : null,
      arc: s?.arc
        ? {
            chainId: 5042002,
            rpc: s.arc.adapter.net.rpc,
            usdc: s.arc.adapter.net.usdc,
            eurc: s.arc.adapter.net.eurc,
            deployments: s.arc.deployments ?? null,
            stableFx: s.arc.stableFxApiKey ? "configured" : "BLOCKED: institutional API key",
            cctpDomain: 26,
          }
        : null,
      blocked: s?.blocked ?? [],
    };
  });

  app.post("/v1/routes/plan", async (req) => {
    const parsed = PlanSchema.safeParse(req.body);
    if (!parsed.success) throw errors.validation({ issues: parsed.error.issues });
    if (!deps.systems) throw errors.unsupported("no systems configured");
    const { maxSlippageBps, ...rest } = parsed.data;
    const plans = await planRoutes(deps.systems.planner, {
      ...rest,
      amountIn: BigInt(rest.amountIn),
      ...(maxSlippageBps !== undefined ? { maxSlippageBps } : {}),
    });
    return plans.map((p) => ({
      ...p,
      amountIn: p.amountIn.toString(),
      amountOut: p.amountOut.toString(),
      legs: p.legs.map((l) => ({
        ...l,
        amountIn: l.amountIn.toString(),
        amountOut: l.amountOut.toString(),
        minAmountOut: l.minAmountOut?.toString(),
        feeBaseUnits: l.feeBaseUnits.toString(),
      })),
    }));
  });
}
