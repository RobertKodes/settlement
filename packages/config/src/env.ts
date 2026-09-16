import { z } from "zod";

/**
 * Process environment, validated once at startup. Services import `loadEnv()` instead of reading
 * `process.env` directly so a typo fails loudly at boot instead of in a settlement path.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  L1_RPC_URL: z.url().default("http://localhost:8445"),
  L1_CHAIN_ID: z.coerce.number().int().positive().default(31648428),
  L2_RPC_URL: z.url().default("http://localhost:8645"),
  L2_CHAIN_ID: z.coerce.number().int().positive().default(1337),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgres://settlement:settlement@localhost:5439/settlement"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6389"),
  CIRCLE_ENV: z.enum(["sandbox", "mainnet"]).default("sandbox"),
  BRIDGE_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
});
export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}
