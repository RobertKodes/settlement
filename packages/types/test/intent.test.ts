import { describe, expect, it } from "vitest";
import {
  canTransition,
  INTENT_TRANSITIONS,
  IntentSchema,
  IntentStatusSchema,
  isTerminal,
} from "../src/intent.js";

// Blueprint section 7 example, verbatim apart from the dropped venue name.
const blueprintExample = {
  action: "settle",
  source: { asset: "USDC", amount: "5000000" },
  destination: { asset: "EURC", recipient: "institution-b" },
  constraints: {
    maxSlippageBps: 5,
    deadline: "2026-09-16T18:30:00Z",
    requireAtomicity: true,
    allowedVenues: ["native", "arc"],
  },
};

describe("IntentSchema", () => {
  it("accepts the blueprint example", () => {
    const parsed = IntentSchema.parse(blueprintExample);
    expect(parsed.constraints.requireAtomicity).toBe(true);
    expect(parsed.source.amount).toBe("5000000");
  });

  it("rejects non-integer amounts", () => {
    expect(() =>
      IntentSchema.parse({ ...blueprintExample, source: { asset: "USDC", amount: "5.5" } }),
    ).toThrow();
    expect(() =>
      IntentSchema.parse({ ...blueprintExample, source: { asset: "USDC", amount: "007" } }),
    ).toThrow();
  });

  it("defaults constraints when omitted", () => {
    const { constraints: _c, ...noConstraints } = blueprintExample;
    expect(IntentSchema.parse(noConstraints).constraints.requireAtomicity).toBe(false);
  });
});

describe("intent lifecycle", () => {
  it("follows the section 7 happy path in order", () => {
    const path = [
      "CREATED",
      "AUTHORIZED",
      "QUOTED",
      "POLICY_CHECKED",
      "ROUTE_LOCKED",
      "EXECUTING",
      "SETTLED",
      "PROVEN",
      "RECONCILED",
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!), `${path[i]} -> ${path[i + 1]}`).toBe(true);
    }
  });

  it("never moves backwards along the happy path", () => {
    const order = [
      "CREATED",
      "AUTHORIZED",
      "QUOTED",
      "POLICY_CHECKED",
      "ROUTE_LOCKED",
      "EXECUTING",
      "SETTLED",
      "PROVEN",
      "RECONCILED",
    ] as const;
    for (let i = 0; i < order.length; i++) {
      for (let j = 0; j < i; j++) {
        expect(canTransition(order[i]!, order[j]!), `${order[i]} -> ${order[j]}`).toBe(false);
      }
    }
  });

  it("cannot cancel once executing", () => {
    expect(canTransition("EXECUTING", "CANCELLED")).toBe(false);
    expect(canTransition("EXECUTING", "FAILED_EXECUTION")).toBe(true);
  });

  it("every status is either terminal or has an exit, and every failure state is terminal", () => {
    for (const s of IntentStatusSchema.options) {
      expect(isTerminal(s) || INTENT_TRANSITIONS[s].length > 0).toBe(true);
      if (s.startsWith("FAILED_") || s === "EXPIRED" || s === "CANCELLED")
        expect(isTerminal(s)).toBe(true);
    }
  });
});
