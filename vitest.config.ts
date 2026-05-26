import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "@stoa": resolve(__dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts", "viewer/src/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 30000,
    pool: "threads",
    setupFiles: ["./tests/setup.ts"],
  },
});
