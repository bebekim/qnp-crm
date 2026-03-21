import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/__integration__/**/*.integration.test.ts"],
    globalSetup: ["src/__integration__/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
