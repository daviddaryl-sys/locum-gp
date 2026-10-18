// @vitest-environment node

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const supabaseConfig = readFileSync(
  new URL("../../../../supabase/config.toml", import.meta.url),
  "utf8",
);
const environmentExample = readFileSync(
  new URL("../../../.env.example", import.meta.url),
  "utf8",
);
const deploymentRunbook = readFileSync(
  new URL("../../../../docs/runbooks/pwa-deployment.md", import.meta.url),
  "utf8",
);
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const reviewableExtensions = new Set([
  ".md",
  ".toml",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".json",
]);

function isReviewableFile(path: string) {
  return path.endsWith("/.env.example") || reviewableExtensions.has(extname(path));
}

function committedConfigurationFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (
      (entry.name.startsWith(".") && entry.name !== ".env.example") ||
      entry.name === "node_modules" ||
      entry.name === ".next"
    ) {
      return [];
    }

    const path = join(directory, entry.name);
    if (entry.isDirectory()) return committedConfigurationFiles(path);
    if (
      entry.name === ".env.example" ||
      reviewableExtensions.has(extname(entry.name))
    ) {
      return [path];
    }
    return [];
  });
}

function committedFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    })
      .split("\0")
      .filter(Boolean)
      .map((file) => join(repositoryRoot, file))
      .filter(isReviewableFile);
  } catch {
    return committedConfigurationFiles(repositoryRoot);
  }
}

describe("Google authentication deployment defaults", () => {
  it("disables new Supabase user sign-ups", () => {
    expect(supabaseConfig).toMatch(
      /^\[auth\]$(?:(?!^\[)[\s\S])*?^enable_signup = false$/m,
    );
  });

  it("keeps the public Google control disabled by default", () => {
    expect(environmentExample).toMatch(
      /^NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false$/m,
    );
  });

  it("keeps the Google Calendar integration disabled by default", () => {
    expect(environmentExample).toMatch(/^GOOGLE_CALENDAR_ENABLED=false$/m);
  });

  it("commits no non-empty Google Calendar secret assignment", () => {
    const files = committedFiles();
    const forbiddenAssignment =
      /^[ \t]*(?:GOOGLE_CALENDAR_CLIENT_SECRET|GOOGLE_CALENDAR_TOKEN_KEY)[ \t]*=[ \t]*[^ \t\r\n#].*$/m;

    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(forbiddenAssignment);
    }
  }, 15_000);

  it("confines Google acceptance to an owner-authorized private HTTPS origin", () => {
    expect(deploymentRunbook).toContain(
      "exact owner-supplied HTTPS private acceptance origin",
    );
    expect(deploymentRunbook).toMatch(
      /owner-only\s+access policy/,
    );
    expect(deploymentRunbook).toContain(
      "NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true only on that private acceptance deployment",
    );
    expect(deploymentRunbook).toMatch(
      /public production deployment remains false until invited and uninvited\s+acceptance evidence is complete/,
    );
  });

  it("requires authorization before changing Google acceptance configuration", () => {
    expect(deploymentRunbook).toContain(
      "Obtain explicit owner authorization before any of the following:",
    );
    expect(deploymentRunbook).toMatch(
      /private acceptance hostname, owner-only access\s+policy, or DNS/,
    );
    expect(deploymentRunbook).toContain(
      "Supabase Auth Site URL or redirect allow-list",
    );
    expect(deploymentRunbook).toMatch(
      /Google provider, sign-up setting, or deployment\s+flag/,
    );
    expect(deploymentRunbook).toContain(
      "https://imskaggarofqlqssoxow.supabase.co/auth/v1/callback",
    );
  });

  it("requires invited and uninvited evidence before public Google enablement", () => {
    expect(deploymentRunbook).toContain(
      "Owner-performed fictional-account acceptance checks",
    );
    expect(deploymentRunbook).toContain(
      "uninvited attempt creates no `auth.users` row",
    );
    expect(deploymentRunbook).toMatch(
      /remove the temporary acceptance\s+redirect and hostname/,
    );
    expect(deploymentRunbook).toMatch(
      /keep it disabled and private only with\s+explicit owner approval/,
    );
    expect(deploymentRunbook).toMatch(
      /Next, enable, build, and deploy the reviewed public artifact with\s+`NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`/,
    );
  });

  it("keeps the approved public Google details behind a separate owner gate", () => {
    expect(deploymentRunbook).toContain("external audience");
    expect(deploymentRunbook).toContain("app name `Locum Manager`");
    expect(deploymentRunbook).toMatch(
      /`linktheworlds\.co\.uk`\s+authorized\s+domain/,
    );
    expect(deploymentRunbook).toContain(
      "owner-approved public homepage, privacy-policy, and terms URLs",
    );
    expect(deploymentRunbook).toContain(
      "https://locum-manager.linktheworlds.co.uk/auth/confirm",
    );
    expect(deploymentRunbook).toContain(
      "https://locum-manager.linktheworlds.co.uk/auth/reset",
    );
    expect(deploymentRunbook).toMatch(
      /Only after that evidence is complete and the owner explicitly authorizes public\s+enablement/,
    );
  });

  it("orders final production authorization before public Google enablement and cleanup", () => {
    const normalizedRunbook = deploymentRunbook.replace(/\s+/g, " ");
    const privateEvidence = normalizedRunbook.indexOf(
      "Only after that evidence is complete and the owner explicitly authorizes public enablement",
    );
    const finalSupabaseConfiguration = normalizedRunbook.indexOf(
      "First, apply and verify the final production Supabase Auth Site URL",
    );
    const publicDeployment = normalizedRunbook.indexOf(
      "Next, enable, build, and deploy the reviewed public artifact",
    );
    const publicSmokeTests = normalizedRunbook.indexOf(
      "complete password, Google, password-reset, account-isolation, and admin-privacy smoke tests",
    );
    const privateCleanup = normalizedRunbook.indexOf(
      "Only after the public smoke tests succeed, remove the temporary acceptance redirect and hostname",
    );

    expect(privateEvidence).toBeGreaterThanOrEqual(0);
    expect(finalSupabaseConfiguration).toBeGreaterThan(privateEvidence);
    expect(publicDeployment).toBeGreaterThan(finalSupabaseConfiguration);
    expect(publicSmokeTests).toBeGreaterThan(publicDeployment);
    expect(privateCleanup).toBeGreaterThan(publicSmokeTests);
  });

  it("bounds rollback to the fail-closed artifact and smoke checks", () => {
    const normalizedRunbook = deploymentRunbook.replace(/\s+/g, " ");

    expect(normalizedRunbook).toContain(
      "Rollback authorization is limited to setting `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false`, deploying the fail-closed artifact, and repeating password and password-reset smoke tests.",
    );
    expect(normalizedRunbook).toContain(
      "It does not authorize disabling the Google provider, deleting the OAuth client, or altering redirects.",
    );
  });
});
