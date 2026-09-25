// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * The diagnostic warns once per operation through module-level state, so each
 * test needs a fresh copy of the module rather than a shared one.
 */
async function loadJobs() {
  vi.resetModules();
  const [{ createIntegrationServerClient }, jobsModule] = await Promise.all([
    import("../integration-client"),
    import("../../../farm-integrations/src/jobs/index"),
  ]);
  const { defineTasks, jobs, task, trigger } = jobsModule;

  const tasks = defineTasks({
    sendEmail: task({
      description: "Object input task.",
      async run(input: { input?: string; to?: string }) {
        return { ok: true, input };
      },
    }),
  });

  const integration = jobs({ runtime: trigger({ apiKey: "tr_dev_test" }), tasks });
  const api = createIntegrationServerClient(
    { integrations: { jobs: integration } },
    { request: new Request("https://farmjs.dev/jobs") },
  );
  return api as { jobs: { sendEmail: Record<string, (args: unknown) => Promise<unknown>> } };
}

describe("deprecated jobs envelope diagnostics", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "development";
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({ id: "run_1" }));
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it("warns that the legacy trigger envelope is deprecated and names the replacement", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const api = await loadJobs();

    await api.jobs.sendEmail.trigger({ body: { input: "digest" } });

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain("[farm:jobs]");
    expect(message).toContain("deprecated");
    expect(message).toContain("$input");
  });

  it("does not put any payload data in the warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const api = await loadJobs();

    await api.jobs.sendEmail.trigger({
      body: { input: "secret-token-value", options: { idempotencyKey: "user@example.com" } },
    });

    const message = String(warn.mock.calls[0]?.[0]);
    // A job payload can carry user data, so the diagnostic describes the shape
    // rather than echoing the body or even its key names.
    expect(message).not.toContain("secret-token-value");
    expect(message).not.toContain("user@example.com");
  });

  it("stays silent for the collision-free $input form", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const api = await loadJobs();

    await api.jobs.sendEmail.trigger({ body: { $input: { input: "digest" } } });

    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent for an inline object body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const api = await loadJobs();

    await api.jobs.sendEmail.trigger({ body: { to: "someone" } });

    expect(warn).not.toHaveBeenCalled();
  });

  it("warns on the legacy schedule envelope too", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const api = await loadJobs();

    await api.jobs.sendEmail.schedule({ body: { input: "digest", at: "2026-01-01T00:00:00Z" } });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("schedule");
  });

  it("warns once per operation rather than on every request", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const api = await loadJobs();

    await api.jobs.sendEmail.trigger({ body: { input: "one" } });
    await api.jobs.sendEmail.trigger({ body: { input: "two" } });
    await api.jobs.sendEmail.trigger({ body: { input: "three" } });

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("stays silent in production", async () => {
    process.env.NODE_ENV = "production";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const api = await loadJobs();

    await api.jobs.sendEmail.trigger({ body: { input: "digest" } });

    expect(warn).not.toHaveBeenCalled();
  });
});
