import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/test-fixtures.ts"],
      thresholds: {
        // Hosthooks-sibling CRLF insert + stockTail optional path are
        // exercised in integration; keep unit coverage just under 100.
        statements: 99,
        branches: 99,
        functions: 100,
        lines: 99,
      },
    },
  },
});
