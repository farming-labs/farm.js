// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Script } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDefaultErrorMarkup,
  DEFAULT_ERROR_STYLES,
  getDefaultErrorStatusText,
  resolveDefaultErrorStatus,
  type DefaultErrorSourceFrame,
} from "../components/error-page";
import { createDefaultErrorDiagnostics } from "../server/error-diagnostics";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("default error page", () => {
  it("renders the approved diagnostic layout in development", () => {
    const sourceFrame: DefaultErrorSourceFrame = {
      file: "src/app/[owner]/page.tsx",
      line: 13,
      column: 16,
      lines: [
        { number: 12, content: "" },
        {
          number: 13,
          content: 'const data = await api<ProfileData>("/users/demo");',
          highlight: true,
        },
        { number: 14, content: "return <Profile data={data} />;" },
      ],
    };
    const html = createDefaultErrorMarkup({
      statusCode: 500,
      requestPath: "/query-demo",
      method: "GET",
      message: 'Request failed: <script>alert("x")</script>',
      errorName: "Error",
      stack: "Error: Request failed\n    at <project>/src/app/[owner]/page.tsx:13:16",
      sourceFrame,
      development: true,
      farmVersion: "0.1.0-beta.31",
      nodeVersion: "v22.0.0",
      mode: "development",
    });

    expect(html).toContain('role="alert"');
    expect(html).toContain("<span>500</span>");
    expect(html).toContain("Something went wrong");
    expect(html).toContain("GET /query-demo");
    expect(html).toContain("500 Internal Server Error");
    expect(html).toContain(">Technical details</h2>");
    expect(html).toContain("COPY DEBUG REPORT");
    expect(html).toContain("https://farm.js.dev/docs");
    expect(html).toContain("farm-default-error__docs-icon");
    expect(html).toContain("src/app/[owner]/page.tsx:13:16");
    expect(html).toContain("farm-default-error__source-line--active");
    expect(html).toContain("# Farm.js debug report");
    expect(html).toContain("TRY AGAIN");
    expect(html).toContain("RETURN HOME");
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");

    const reportMatch = html.match(
      /<script id="farm-default-error-report" type="application\/json">([\s\S]*?)<\/script>/,
    );
    expect(reportMatch).not.toBeNull();
    const report = JSON.parse(reportMatch![1]);
    expect(report).toContain("# Farm.js debug report");
    expect(report).toContain("## Source");
    expect(report).toContain("## Filtered stack");

    const executableScripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g));
    expect(executableScripts).toHaveLength(2);
    for (const script of executableScripts) {
      expect(() => new Script(script[1])).not.toThrow();
    }
  });

  it("gives 400 responses the same shell with a request-safe recovery action", () => {
    const html = createDefaultErrorMarkup({
      statusCode: 400,
      requestPath: "/api/profile?draft=true",
      method: "POST",
      development: false,
    });

    expect(html).toContain("<span>400</span>");
    expect(html).toContain("400 Bad Request");
    expect(html).toContain("This request could not be completed");
    expect(html).toContain("Check the request details, then try again.");
    expect(html).toContain("POST /api/profile?draft=true");
    expect(html).toContain("data-farm-error-back");
    expect(html).toContain("GO BACK");
    expect(html).not.toContain('type="button" data-farm-error-retry');
  });

  it("supports status-bearing failures with matching copy and HTTP labels", () => {
    expect(resolveDefaultErrorStatus(Object.assign(new Error("busy"), { status: 503 }))).toBe(503);
    expect(resolveDefaultErrorStatus({ statusCode: "429" })).toBe(429);
    expect(resolveDefaultErrorStatus({ status: 302 })).toBe(500);
    expect(resolveDefaultErrorStatus(new Error("boom"))).toBe(500);
    expect(getDefaultErrorStatusText(429)).toBe("Too Many Requests");
    expect(getDefaultErrorStatusText(599)).toBe("Server Error");

    const html = createDefaultErrorMarkup({
      statusCode: 503,
      requestPath: "/dashboard",
      development: false,
    });
    expect(html).toContain("<span>503</span>");
    expect(html).toContain("503 Service Unavailable");
    expect(html).toContain("The service is temporarily unavailable");
  });

  it("keeps production output private while preserving recovery actions", () => {
    const html = createDefaultErrorMarkup({
      statusCode: 500,
      requestPath: "/account",
      message: "database password=super-secret",
      stack: "/Users/example/private/app.ts:10:2",
      sourceFrame: {
        file: "src/app/account/page.tsx",
        line: 10,
        column: 2,
        lines: [{ number: 10, content: "throw new Error(secret);", highlight: true }],
      },
      development: false,
    });

    expect(html).toContain(
      "The application ran into an unexpected problem. Try again in a moment.",
    );
    expect(html).toContain("TRY AGAIN");
    expect(html).toContain("RETURN HOME");
    expect(html).not.toContain("COPY DEBUG REPORT");
    expect(html).not.toContain("src/app/account/page.tsx");
    expect(html).not.toContain("super-secret");
    expect(html).not.toContain("/Users/example");
  });

  it("supports adaptive themes, responsive reflow, and reduced motion", () => {
    expect(DEFAULT_ERROR_STYLES).toContain("@media (prefers-color-scheme: light)");
    expect(DEFAULT_ERROR_STYLES).toContain(".dark .farm-default-error");
    expect(DEFAULT_ERROR_STYLES).toContain('[data-theme="dark"]');
    expect(DEFAULT_ERROR_STYLES).toContain('[data-theme="light"]');
    expect(DEFAULT_ERROR_STYLES).toContain("@media (max-width: 620px)");
    expect(DEFAULT_ERROR_STYLES).toContain("@media (prefers-reduced-motion: reduce)");
    expect(DEFAULT_ERROR_STYLES).toContain("border: 1px solid var(--farm-error-line)");
    expect(DEFAULT_ERROR_STYLES).toContain("border-top: 1px solid var(--farm-error-line-strong)");
    expect(DEFAULT_ERROR_STYLES).toContain("outline: 2px solid var(--farm-error-fg)");
    expect(DEFAULT_ERROR_STYLES).toContain(
      '--farm-error-font-sans: "Geist Variable", "Geist Sans", Geist, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    );
    expect(DEFAULT_ERROR_STYLES).toContain(
      '--farm-error-font-mono: "Geist Mono Variable", "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;',
    );
    expect(DEFAULT_ERROR_STYLES).toMatch(
      /\.farm-default-error__title\s*\{[\s\S]*font-family: var\(--farm-error-font-sans\);/,
    );
    expect(DEFAULT_ERROR_STYLES).toMatch(
      /\.farm-default-error__action\s*\{[\s\S]*font-family: var\(--farm-error-font-mono\);/,
    );
    expect(DEFAULT_ERROR_STYLES).toContain("font-synthesis: none;");
    expect(DEFAULT_ERROR_STYLES).toContain("font-size: clamp(36px, 5.2vw, 56px)");
  });
});

describe("default error diagnostics", () => {
  it("finds the failing project line and redacts common secrets", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "farm-error-page-"));
    temporaryDirectories.push(root);
    const sourcePath = path.join(root, "src", "app", "profile", "page.tsx");
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(
      sourcePath,
      [
        "export async function ProfilePage() {",
        '  const owner = "demo";',
        "  const data = await loadProfile(owner);",
        "  return data;",
        "}",
      ].join("\n"),
      "utf8",
    );

    const error = new Error("Profile failed token=private-value");
    error.stack = [
      "Error: Profile failed token=private-value",
      `    at ProfilePage (${sourcePath}:3:16)`,
      "    at processTicksAndRejections (node:internal/process/task_queues:105:5)",
    ].join("\n");

    const diagnostics = createDefaultErrorDiagnostics(error, root);

    expect(diagnostics.message).toBe("Profile failed token=[REDACTED]");
    expect(diagnostics.stack).toContain("<project>/src/app/profile/page.tsx:3:16");
    expect(diagnostics.stack).not.toContain("private-value");
    expect(diagnostics.stack).not.toContain("node:internal");
    expect(diagnostics.sourceFrame).toMatchObject({
      file: "src/app/profile/page.tsx",
      line: 3,
      column: 16,
    });
    expect(diagnostics.sourceFrame?.lines.find((line) => line.highlight)).toEqual({
      number: 3,
      content: "  const data = await loadProfile(owner);",
      highlight: true,
    });
  });

  it("redacts OAuth clientSecret and secretKey values from message and stack", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "farm-error-page-"));
    temporaryDirectories.push(root);
    const sourcePath = path.join(root, "src", "app", "auth", "page.tsx");
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(
      sourcePath,
      [
        "export async function AuthPage() {",
        "  const config = await loadOAuthConfig();",
        "  return config;",
        "}",
      ].join("\n"),
      "utf8",
    );

    const secret = "sk-1234567890abcdef";
    const error = new Error(
      `OAuth config: clientSecret="${secret}" secretKey=${secret} client_secret: ${secret}`,
    );
    error.stack = [
      `Error: OAuth config: clientSecret="${secret}" secretKey=${secret} client_secret: ${secret}`,
      `    at AuthPage (${sourcePath}:2:22)`,
      "    at processTicksAndRejections (node:internal/process/task_queues:105:5)",
    ].join("\n");

    const diagnostics = createDefaultErrorDiagnostics(error, root);

    expect(diagnostics.message).not.toContain(secret);
    expect(diagnostics.message).toContain("clientSecret=[REDACTED]");
    expect(diagnostics.message).toContain("secretKey=[REDACTED]");
    expect(diagnostics.message).toContain("client_secret=[REDACTED]");
    expect(diagnostics.stack).not.toContain(secret);
    expect(diagnostics.stack).toContain("<project>/src/app/auth/page.tsx:2:22");
  });

  it("redacts secret identifiers across camelCase, snake_case, and colon forms", () => {
    const root = os.tmpdir();
    const probe = (message: string) =>
      createDefaultErrorDiagnostics(new Error(message), root).message;

    expect(probe("clientSecret=abc")).toBe("clientSecret=[REDACTED]");
    expect(probe("client_secret=abc")).toBe("client_secret=[REDACTED]");
    expect(probe("secretKey=abc")).toBe("secretKey=[REDACTED]");
    expect(probe("secret_key=abc")).toBe("secret_key=[REDACTED]");
    expect(probe('clientSecret: "sk-xyz"')).toBe("clientSecret=[REDACTED]");

    expect(probe("apiKey=abc")).toBe("apiKey=[REDACTED]");
    expect(probe("api_key=abc")).toBe("api_key=[REDACTED]");
    expect(probe("accessToken=abc")).toBe("accessToken=[REDACTED]");
    expect(probe("authToken=abc")).toBe("authToken=[REDACTED]");
    expect(probe("token=abc")).toBe("token=[REDACTED]");
    expect(probe("password=abc")).toBe("password=[REDACTED]");
    expect(probe("secret=abc")).toBe("secret=[REDACTED]");
  });
});
