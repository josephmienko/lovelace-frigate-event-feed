import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup-vitest.mjs"],
    include: ["tests/**/*.test.mjs"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.js"],
      exclude: ["dist/**", "tests/**"],
      reporter: ["text-summary", "lcov"],
    },
  },
});
