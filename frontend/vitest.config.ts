import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost/",
      },
    },
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    server: {
      deps: {
        // streamdown ESM build imports KaTeX CSS; inline it so Vite can transform CSS imports.
        inline: ["streamdown"],
      },
    },
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    coverage: {
      enabled: false,
    },
  },
});
