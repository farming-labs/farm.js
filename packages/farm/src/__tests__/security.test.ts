import { describe, expect, it } from "vitest";
import {
  addFarmCspNonceToScriptTags,
  applyFarmCspHashesToHtml,
  applyFarmCspHashesToPolicy,
  applyFarmCspNonceToPolicy,
  applyFarmCspNonceToResponse,
  createFarmCspScriptHashes,
  farmCspBlocksFrameworkInlineScripts,
  getFarmSecurityHeader,
  removeFarmCspNoncesFromScriptTags,
  resolveFarmSecurityConfig,
  serializeFarmCspDirectives,
} from "../security";

describe("security.csp", () => {
  it("serializes camelCase directives without changing source expressions", () => {
    expect(
      serializeFarmCspDirectives({
        defaultSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: true,
      }),
    ).toBe("default-src 'self'; object-src 'none'; upgrade-insecure-requests");
  });

  it("resolves an enforcing policy string", () => {
    const security = resolveFarmSecurityConfig({
      csp: "default-src 'self'; object-src 'none';",
    });

    expect(getFarmSecurityHeader(security)).toEqual({
      key: "Content-Security-Policy",
      value: "default-src 'self'; object-src 'none'",
    });
  });

  it("supports report-only directives", () => {
    const security = resolveFarmSecurityConfig({
      csp: {
        reportOnly: true,
        directives: {
          defaultSrc: ["'self'"],
          reportTo: ["csp-endpoint"],
        },
      },
    });

    expect(getFarmSecurityHeader(security)).toEqual({
      key: "Content-Security-Policy-Report-Only",
      value: "default-src 'self'; report-to csp-endpoint",
    });
  });

  it("revalidates resolved policy values", () => {
    expect(
      resolveFarmSecurityConfig({
        csp: { value: "default-src 'self';", reportOnly: true, nonce: false },
      }),
    ).toEqual({
      csp: { value: "default-src 'self'", reportOnly: true, nonce: false },
    });

    expect(() =>
      resolveFarmSecurityConfig({
        csp: { value: "default-src 'self'\r\nX-Test: yes", reportOnly: false, nonce: false },
      }),
    ).toThrow(/single-line/);
  });

  it("rejects the long-form config key with an actionable diagnostic", () => {
    expect(() => resolveFarmSecurityConfig({ contentSecurityPolicy: true } as never)).toThrow(
      /Use security\.csp instead/,
    );
  });

  it("rejects duplicate directives and header injection", () => {
    expect(() =>
      serializeFarmCspDirectives({ defaultSrc: ["'self'"], "default-src": ["https:"] }),
    ).toThrow(/duplicate directive/);
    expect(() => resolveFarmSecurityConfig({ csp: "default-src 'self'\r\nX-Test: yes" })).toThrow(
      /single-line/,
    );
    expect(() => serializeFarmCspDirectives({ reportUri: ["/csp; object-src *"] })).toThrow(
      /Invalid security\.csp directive value/,
    );
    expect(() => resolveFarmSecurityConfig({ csp: "" })).toThrow(/non-empty/);
  });

  it("rejects malformed runtime option shapes with actionable errors", () => {
    expect(() => resolveFarmSecurityConfig({ csp: null } as never)).toThrow(
      /policy string, false, or an options object/,
    );
    expect(() => resolveFarmSecurityConfig({ csp: { policy: 42 } } as never)).toThrow(
      /non-empty single-line string/,
    );
    expect(() => resolveFarmSecurityConfig({ csp: { directives: null } } as never)).toThrow(
      /directives must be an object/,
    );
    expect(() =>
      resolveFarmSecurityConfig({
        csp: { policy: "default-src 'self'", reportOnly: "yes" },
      } as never),
    ).toThrow(/reportOnly must be a boolean/);
    expect(() =>
      resolveFarmSecurityConfig({
        csp: { policy: "default-src 'self'", nonce: "yes" },
      } as never),
    ).toThrow(/nonce must be a boolean/);
  });

  it("adds a per-response nonce to the governing script directive", () => {
    expect(applyFarmCspNonceToPolicy("default-src 'self'; object-src 'none'", "abc123")).toBe(
      "default-src 'self' 'nonce-abc123'; object-src 'none'",
    );
    expect(
      applyFarmCspNonceToPolicy(
        "default-src 'self'; script-src 'self'; script-src-elem https:",
        "abc123",
      ),
    ).toBe("default-src 'self'; script-src 'self'; script-src-elem https: 'nonce-abc123'");
    expect(applyFarmCspNonceToPolicy("img-src 'self'", "abc123")).toBe(
      "img-src 'self'; script-src 'nonce-abc123'",
    );
  });

  it("adds unique hashes to the governing script directive", () => {
    expect(
      applyFarmCspHashesToPolicy("default-src 'self'; script-src-elem 'self'", [
        "sha256-YWJjZA==",
        "sha256-YWJjZA==",
        "sha384-ZWZnaA==",
      ]),
    ).toBe("default-src 'self'; script-src-elem 'self' 'sha256-YWJjZA==' 'sha384-ZWZnaA=='");
    expect(applyFarmCspHashesToPolicy("img-src 'self'", ["sha256-YWJjZA=="])).toBe(
      "img-src 'self'; script-src 'sha256-YWJjZA=='",
    );
    expect(() => applyFarmCspHashesToPolicy("script-src 'self'", ["sha256-bad value"])).toThrow(
      /Invalid CSP script hash/,
    );
  });

  it("normalizes every script tag to the response nonce", () => {
    expect(
      addFarmCspNonceToScriptTags(
        '<script>one()</script><SCRIPT type="module" src="/app.js"></SCRIPT><script nonce="app">two()</script>',
        "abc123",
      ),
    ).toBe(
      '<script nonce="abc123">one()</script><script nonce="abc123" type="module" src="/app.js"></SCRIPT><script nonce="abc123">two()</script>',
    );
  });

  it("does not rewrite script-like text or stop at quoted angle brackets", () => {
    const html =
      '<script data-label="a > b">const sample = "<script>nested";</script>' +
      '<style>.example::after { content: "<script>"; }</style>' +
      "<!-- <script>commented()</script> -->" +
      "<script>real()</script>";

    expect(addFarmCspNonceToScriptTags(html, "abc123")).toBe(
      '<script nonce="abc123" data-label="a > b">const sample = "<script>nested";</script>' +
        '<style>.example::after { content: "<script>"; }</style>' +
        "<!-- <script>commented()</script> -->" +
        '<script nonce="abc123">real()</script>',
    );
  });

  it("removes only real script nonce attributes", () => {
    expect(
      removeFarmCspNoncesFromScriptTags(
        '<script data-label="nonce=\'keep\'" nonce = "remove" nonce=also-remove>one()</script>' +
          "<!-- <script nonce='keep'>commented()</script> -->" +
          "<script NONCE=remove src='/app.js'></script>",
      ),
    ).toBe(
      "<script data-label=\"nonce='keep'\">one()</script>" +
        "<!-- <script nonce='keep'>commented()</script> -->" +
        "<script src='/app.js'></script>",
    );
  });

  it("hashes exact inline script contents and ignores external or script-like text", async () => {
    const first = "\n  one();\n";
    const html =
      `<script nonce="old">${first}</script>` +
      `<script>${first}</script>` +
      '<script src="/app.js"></script>' +
      '<style>.example::after { content: "<script>ignored()</script>"; }</style>' +
      "<!-- <script>commented()</script> -->" +
      "<script>two()</script>";
    const expectedFirst = await sha256(first);
    const expectedSecond = await sha256("two()");

    expect(await createFarmCspScriptHashes(html)).toEqual([expectedFirst, expectedSecond]);

    const result = await applyFarmCspHashesToHtml(
      html,
      resolveFarmSecurityConfig({
        csp: { policy: "script-src 'self'; object-src 'none'", nonce: true },
      }),
    );
    expect(result?.html).not.toContain('nonce="old"');
    expect(result?.header).toEqual({
      key: "Content-Security-Policy",
      value: `script-src 'self' '${expectedFirst}' '${expectedSecond}'; object-src 'none'`,
    });
  });

  it("rewrites streamed script tags split across response chunks", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode("<!doctype html><scr"));
        controller.enqueue(encoder.encode('ipt type="module" src="/app.js"></script><script'));
        controller.enqueue(encoder.encode(">inline()</script>"));
        controller.close();
      },
    });
    const security = resolveFarmSecurityConfig({
      csp: { policy: "script-src 'self'", nonce: true },
    });
    const response = applyFarmCspNonceToResponse(
      new Response(stream, { headers: { "content-type": "text/html; charset=utf-8" } }),
      security,
    );
    const policy = response.headers.get("content-security-policy")!;
    const nonce = policy.match(/'nonce-([^']+)'/)?.[1];

    expect(nonce).toBeTruthy();
    expect(await response.text()).toBe(
      `<!doctype html><script nonce="${nonce}" type="module" src="/app.js"></script><script nonce="${nonce}">inline()</script>`,
    );
  });
});

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return `sha256-${globalThis.btoa(binary)}`;
}

describe("farmCspBlocksFrameworkInlineScripts", () => {
  const blocks = (csp: string) =>
    farmCspBlocksFrameworkInlineScripts(resolveFarmSecurityConfig({ csp }));

  it("flags a script-src allowlist with no inline mechanism", () => {
    expect(blocks("script-src 'self' https://cdn.example.com")).toBe(true);
  });

  it("flags default-src when script-src is absent", () => {
    expect(blocks("default-src 'self'")).toBe(true);
  });

  it("does not flag 'unsafe-inline'", () => {
    expect(blocks("script-src 'self' 'unsafe-inline'")).toBe(false);
  });

  it("flags nonce, hash, and strict-dynamic sources because Farm's scripts carry none", () => {
    expect(blocks("script-src 'self' 'nonce-abc123'")).toBe(true);
    expect(blocks("script-src 'self' 'sha256-abcd'")).toBe(true);
    expect(blocks("script-src 'strict-dynamic' 'unsafe-inline'")).toBe(true);
  });

  it("flags 'unsafe-inline' when a nonce or hash makes browsers ignore it", () => {
    expect(blocks("script-src 'self' 'unsafe-inline' 'nonce-abc123'")).toBe(true);
    expect(blocks("default-src 'self' 'unsafe-inline' 'sha384-abcd'")).toBe(true);
  });

  it("prefers script-src-elem for script elements", () => {
    expect(blocks("script-src 'self' 'unsafe-inline'; script-src-elem 'self'")).toBe(true);
    expect(blocks("script-src 'self'; script-src-elem 'self' 'unsafe-inline'")).toBe(false);
  });

  it("prefers script-src over default-src", () => {
    // default-src would block, but the explicit script-src allows inline.
    expect(blocks("default-src 'self'; script-src 'self' 'unsafe-inline'")).toBe(false);
    // and the reverse: permissive default, restrictive script-src.
    expect(blocks("default-src 'unsafe-inline'; script-src 'self'")).toBe(true);
  });

  it("does not flag a policy that governs no scripts", () => {
    expect(blocks("img-src 'self'; style-src 'self'")).toBe(false);
  });

  it("does not flag when CSP is disabled", () => {
    expect(farmCspBlocksFrameworkInlineScripts(resolveFarmSecurityConfig(undefined))).toBe(false);
  });

  it("does not flag a strict policy when runtime nonces are enabled", () => {
    expect(
      farmCspBlocksFrameworkInlineScripts(
        resolveFarmSecurityConfig({ csp: { policy: "script-src 'self'", nonce: true } }),
      ),
    ).toBe(false);
  });
});
