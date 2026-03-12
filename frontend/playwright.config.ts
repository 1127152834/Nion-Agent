import { defineConfig } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const baseURL = `http://127.0.0.1:${port}`;
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  fullyParallel: false,
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: skipWebServer
    ? undefined
    : {
        command:
          `SKIP_ENV_VALIDATION=1 BETTER_AUTH_SECRET=8f1c7f4e2d3a6b9c0e4f8a1d5c7b9e2f BETTER_AUTH_BASE_URL=${baseURL} ` +
          `pnpm run build && ` +
          `SKIP_ENV_VALIDATION=1 BETTER_AUTH_SECRET=8f1c7f4e2d3a6b9c0e4f8a1d5c7b9e2f BETTER_AUTH_BASE_URL=${baseURL} ` +
          `pnpm exec next start --port ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
