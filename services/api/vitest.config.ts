import { defineConfig } from "vitest/config";

// Devnet test files share the bundler key and the local chain: run files one after another to avoid nonce races.
export default defineConfig({ test: { fileParallelism: false } });
