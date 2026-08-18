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
    expect(html).toContain(">500</p>");
    expect(html).toContain("Runtime error");
    expect(html).toContain("Application failed during server rendering");
    expect(html).toContain("GET /query-demo");
    expect(html).toContain("500 Internal Server Error");
    expect(html).toContain(">Details</h2>");
    expect(html).toContain("COPY DEBUG REPORT");
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
    expect(html).toContain(">503</p>");
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

    expect(html).toContain("An unexpected error prevented this page from rendering.");
    expect(html).toContain("TRY AGAIN");
    expect(html).toContain("RETURN HOME");
    expect(html).not.toContain("COPY DEBUG REPORT");
    expect(html).not.toContain("src/app/account/page.tsx");
    expect(html).not.toContain("super-secret");
    expect(html).not.toContain("/Users/example");
  });

  it("supports adaptive themes, responsive reflow, and reduced motion", () => {
    expect(DEFAULT_ERROR_STYLES).toContain("@media (prefers-color-scheme: dark)");
    expect(DEFAULT_ERROR_STYLES).toContain(".dark .farm-default-error");
    expect(DEFAULT_ERROR_STYLES).toContain('[data-theme="dark"]');
    expect(DEFAULT_ERROR_STYLES).toContain('[data-theme="light"]');
    expect(DEFAULT_ERROR_STYLES).toContain("@media (max-width: 620px)");
    expect(DEFAULT_ERROR_STYLES).toContain("@media (prefers-reduced-motion: reduce)");
    expect(DEFAULT_ERROR_STYLES).toContain("border: 1px solid var(--farm-error-line)");
    expect(DEFAULT_ERROR_STYLES).toContain("border: 1px solid var(--farm-error-line-strong)");
    expect(DEFAULT_ERROR_STYLES).toContain("outline: 1px solid var(--farm-error-fg)");
    expect(DEFAULT_ERROR_STYLES).toContain(
      'font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    );
    expect(DEFAULT_ERROR_STYLES).toContain("font-size: clamp(76px, 13vw, 112px)");
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
});
