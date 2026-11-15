// Branch coverage only: bun test reports lines but writes no BRDA records.
// The bun:test alias lets vitest run the same test files under Node with V8 coverage.
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "bun:test": "vitest" } },
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
