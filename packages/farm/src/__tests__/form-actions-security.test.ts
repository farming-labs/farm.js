// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  FARM_FORM_ACTION_HEADER,
  handleFarmFormActionRequest,
  registerFarmFormAction,
} from "../form-actions";
import { resolveServerActionsConfig, validateServerActionRequest } from "../server-action-security";

type Transport = "javascript" | "form";

function actionRequest(
  transport: Transport,
  id: string,
  headers: Record<string, string>,
  value = "saved",
) {
  return new Request("https://app.test/todos", {
    method: "POST",
    headers: {
      ...headers,
      ...(transport === "javascript"
        ? { [FARM_FORM_ACTION_HEADER]: id, "content-type": "text/plain;charset=UTF-8" }
        : { "content-type": "application/x-www-form-urlencoded" }),
    },
    body:
      transport === "javascript"
        ? JSON.stringify({ a: [value] })
        : new URLSearchParams({ $F_REF_R_1_: "", "$F_R_1_:A": id, title: value }),
  });
}

const origins: {
  name: string;
  headers: Record<string, string>;
  allowedOrigins?: string[];
  allowed: boolean;
}[] = [
  { name: "same origin", headers: { origin: "https://app.test" }, allowed: true },
  { name: "same-origin referer", headers: { referer: "https://app.test/todos" }, allowed: true },
  { name: "fetch metadata alone", headers: { "sec-fetch-site": "same-origin" }, allowed: true },
  { name: "missing origin metadata", headers: {}, allowed: false },
  { name: "same-site metadata alone", headers: { "sec-fetch-site": "same-site" }, allowed: false },
  { name: "foreign origin", headers: { origin: "https://evil.test" }, allowed: false },
  {
    name: "foreign origin with a same-origin referer",
    headers: { origin: "https://evil.test", referer: "https://app.test/todos" },
    allowed: false,
  },
  {
    name: "opaque origin with same-origin metadata",
    headers: { origin: "null", "sec-fetch-site": "same-origin" },
    allowed: false,
  },
  { name: "malformed origin", headers: { origin: "not an origin" }, allowed: false },
  {
    name: "conflicting cross-site metadata",
    headers: { origin: "https://app.test", "sec-fetch-site": "cross-site" },
    allowed: false,
  },
  {
    name: "matching proxy host",
    headers: { origin: "https://public.test", host: "public.test" },
    allowed: true,
  },
  {
    name: "proxy host with a downgraded scheme",
    headers: { origin: "http://public.test", host: "public.test" },
    allowed: false,
  },
  {
    name: "untrusted forwarded host",
    headers: { origin: "https://evil.test", "x-forwarded-host": "evil.test" },
    allowed: false,
  },
  {
    name: "explicitly trusted cross-site origin",
    headers: { origin: "https://forms.test", "sec-fetch-site": "cross-site" },
    allowedOrigins: ["https://forms.test"],
    allowed: true,
  },
  {
    name: "trusted wildcard subdomain and port",
    headers: { origin: "https://tenant.forms.test:8443" },
    allowedOrigins: ["https://*.forms.test:8443"],
    allowed: true,
  },
  {
    name: "wildcard apex",
    headers: { origin: "https://forms.test" },
    allowedOrigins: ["https://*.forms.test"],
    allowed: false,
  },
  {
    name: "wildcard with a different port",
    headers: { origin: "https://tenant.forms.test:8443" },
    allowedOrigins: ["https://*.forms.test"],
    allowed: false,
  },
  {
    name: "wildcard suffix lookalike",
    headers: { origin: "https://tenant.forms.test.evil.test" },
    allowedOrigins: ["https://*.forms.test"],
    allowed: false,
  },
];

describe.each<Transport>(["javascript", "form"])("islands %s action security", (transport) => {
  it.each(origins)("matches the RSC origin policy for $name", async (scenario) => {
    const id = `origin-${transport}-${origins.indexOf(scenario)}`;
    const action = vi.fn(async () => "saved");
    registerFarmFormAction(action, id);
    const config = resolveServerActionsConfig({ allowedOrigins: scenario.allowedOrigins });
    const request = actionRequest(transport, id, scenario.headers);
    const validateRsc = () => validateServerActionRequest(request, config);

    if (scenario.allowed) expect(validateRsc).not.toThrow();
    else expect(validateRsc).toThrow();

    const response = await handleFarmFormActionRequest(request, config);
    expect(response?.status).toBe(scenario.allowed ? (transport === "form" ? 303 : 200) : 403);
    expect(action).toHaveBeenCalledTimes(scenario.allowed ? 1 : 0);
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  it.each([undefined, "1"])("enforces the body limit with content-length %s", async (length) => {
    const id = `body-${transport}-${length ?? "absent"}`;
    const action = vi.fn();
    registerFarmFormAction(action, id);
    const response = await handleFarmFormActionRequest(
      actionRequest(
        transport,
        id,
        { origin: "https://app.test", ...(length ? { "content-length": length } : {}) },
        "x".repeat(2000),
      ),
      resolveServerActionsConfig({ bodySizeLimit: 100 }),
    );
    expect(response?.status).toBe(413);
    expect(action).not.toHaveBeenCalled();
  });
});

it("keeps repeated fields and files when a native multipart form runs an action", async () => {
  const action = vi.fn(async (_form: FormData) => {});
  registerFarmFormAction(action, "multipart-fields");
  const body = new FormData();
  body.append("$F_REF_R_1_", "");
  body.append("$F_R_1_:A", "multipart-fields");
  body.append("tag", "first");
  body.append("tag", "second");
  body.append("file", new File(["uploaded content"], "note.txt", { type: "text/plain" }));

  const response = await handleFarmFormActionRequest(
    new Request("https://app.test/todos?view=all", {
      method: "POST",
      headers: { origin: "https://app.test" },
      body,
    }),
    resolveServerActionsConfig(undefined),
  );
  expect(response?.status).toBe(303);
  expect(response?.headers.get("location")).toBe("/todos?view=all");
  expect(action).toHaveBeenCalledOnce();
  const received = action.mock.calls[0]![0];
  expect([...received.keys()]).toEqual(["tag", "tag", "file"]);
  expect(received.getAll("tag")).toEqual(["first", "second"]);
  const file = received.get("file") as File;
  expect(file.name).toBe("note.txt");
  expect(file.type).toBe("text/plain");
  expect(await file.text()).toBe("uploaded content");
});
