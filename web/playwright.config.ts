import { defineConfig, devices } from "@playwright/test";

const liveTarget = process.env.LOCUM_E2E_LIVE === "1";
const productionOcrSmoke = process.env.LOCUM_E2E_OCR_PRODUCTION === "1";
const localPort = process.env.LOCUM_E2E_PORT ?? "3210";
const localBaseUrl = `http://127.0.0.1:${localPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.LOCUM_E2E_BASE_URL ?? localBaseUrl,
    extraHTTPHeaders: process.env.LOCUM_E2E_AUTH_BYPASS === "responsive-shell"
      ? {
          "x-locum-e2e-auth": "responsive-shell",
          "x-locum-e2e-owner": "00000000-0000-4000-8000-000000000001",
        }
      : undefined,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "calendar-warmup",
      grep: /@calendar-server-warmup/,
      testMatch: /google-calendar-settings\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      dependencies: ["calendar-warmup"],
      grepInvert: /@calendar-server-warmup/,
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: liveTarget
    ? undefined
    : {
        command:
          productionOcrSmoke
            ? `npm run start -- --hostname 127.0.0.1 --port ${localPort}`
            : `npm run dev -- --webpack --hostname 127.0.0.1 --port ${localPort}`,
        env: {
          GOOGLE_CALENDAR_ENABLED: "true",
          LOCUM_E2E_AUTH_BYPASS: "responsive-shell",
          LOCUM_E2E_OCR_SMOKE: "true",
          NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: "true",
        },
        url: localBaseUrl,
        reuseExistingServer: false,
        timeout: 600_000,
      },
});
