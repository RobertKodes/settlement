import { allInScore } from "./score.js";
import type { RouteDecision, SwapRequest, VenueAdapter, VenueQuote } from "./types.js";

export class SmartRouter {
  constructor(
    private readonly adapters: VenueAdapter[],
    private readonly latencyPenaltyPerSecond = 10n,
  ) {}

  async quotes(req: SwapRequest): Promise<VenueQuote[]> {
    const allowed = new Set(req.allowedVenues ?? ["native", "arc", "external"]);
    const results = await Promise.all(
      this.adapters
        .filter((a) => allowed.has(a.family))
        .map((a) => a.quote(req).catch(() => undefined)),
    );
    return results.filter((q): q is VenueQuote => q !== undefined);
  }

  /** Rank every venue by all-in score and pick the best executable one. Throws when nothing can execute. */
  async route(req: SwapRequest): Promise<RouteDecision> {
    const quotes = await this.quotes(req);
    const ranked = quotes
      .map((q) => ({
        ...q,
        score: allInScore(q, { latencyPenaltyPerSecond: this.latencyPenaltyPerSecond }),
      }))
      .sort((a, b) => b.score - a.score);
    const chosen = ranked.find((q) => q.executable && q.score > 0);
    if (!chosen)
      throw new Error(
        `no executable route for ${req.from}->${req.to}: ${ranked.map((q) => `${q.venue} (${q.reason ?? "score 0"})`).join(", ") || "no venues"}`,
      );
    return {
      chosen,
      ranked,
      legs: [{ venue: chosen.venue, shareBps: 10_000, chainId: req.chainId }],
    };
  }
}
