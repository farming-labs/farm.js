import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { expect, it, vi } from "vitest";
import { observabilityPlugin } from "./index.js";

function quietPlugin(options: Parameters<typeof observabilityPlugin>[0] = {}) {
  return observabilityPlugin({
    ...options,
    telemetry: { logLifecycle: false, ...options.telemetry },
  });
}

it("annotates the page without expanding $ patterns from the request path", () => {
  const plugin = quietPlugin();
  const html = "<html><body><main>secret-page-body</main></body></html>";

  // Pathnames arrive percent-encoded, but $, ` and ' are all legal as-is.
  for (const pathname of ["/a$`b", "/a$'b", "/a$&b"]) {
    const annotated = plugin.afterRender!(html, { pathname, routePattern: "/[slug]" });

    expect(annotated).toBe(
      `<html><body><main>secret-page-body</main><!-- observability:path=${pathname} route=/[slug] -->\n</body></html>`,
    );
    expect(annotated.split("secret-page-body")).toHaveLength(2);
  }
});

it("records the request pathname without its query string", async () => {
  const onIncident = vi.fn();
  const plugin = quietPlugin({ workflow: { callbacks: { onIncident } } });

  const req = new IncomingMessage(new Socket());
  req.url = "/reset-password?token=reset-secret-123";
  req.method = "GET";
  const res = new ServerResponse(req);
  res.statusCode = 500;

  plugin.beforeRequest!(req, res);
  await plugin.afterResponse!(req, res);

  expect(onIncident).toHaveBeenCalledTimes(1);
  const [context] = onIncident.mock.calls[0]!;
  expect(context.signal.request.pathname).toBe("/reset-password");
  expect(context.incident.title).toBe("Request failure GET /reset-password");
  expect(JSON.stringify(context)).not.toContain("reset-secret-123");
});
