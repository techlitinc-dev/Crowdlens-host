import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests boot an embedded Postgres + the Nest application.
    testTimeout: 120_000,
    hookTimeout: 240_000,
    teardownTimeout: 60_000,
  },
});
