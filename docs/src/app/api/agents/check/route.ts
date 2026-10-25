import {
  AGENT_CHECK_REPORT_COOKIE,
  AGENT_CHECK_REPORT_COOKIE_MAX_AGE,
  agentCheckApi,
  agentCheckPath,
  fetchAgentCheck,
} from "../../../../lib/agents-check";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_URL_LENGTH = 2048;

function problem(status: number, error: string, headers?: HeadersInit) {
  return Response.json({ error }, { status, headers });
}

/** The visitor's address as the deployment platform reports it, if it does. */
function visitorAddress(request: Request): string | undefined {
  const forwarded =
    request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0];
  return forwarded?.trim() || undefined;
}

async function readCapped(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

/**
 * Start an agent-ready check. The form posts here without JavaScript and gets a 303 to
 * /agents/check?url=<site>, with the report's id in a short-lived cookie so that page can show
 * it (or back to the form with the error); the enhanced form sends JSON and gets the finished
 * report as JSON. Report ids never appear in a page address.
 */
export async function POST(request: Request) {
  const isForm = (request.headers.get("content-type") ?? "").includes(
    "application/x-www-form-urlencoded",
  );
  const fail = (status: number, error: string, url = "", headers?: HeadersInit) => {
    if (!isForm) return problem(status, error, headers);
    const back = new URL("/agents/check", request.url);
    back.searchParams.set("error", error);
    if (url) back.searchParams.set("url", url.slice(0, MAX_URL_LENGTH));
    return Response.redirect(back, 303);
  };

  const text = await readCapped(request);
  if (text === null) return fail(413, "body_too_large");
  let url: unknown;
  try {
    url = isForm
      ? new URLSearchParams(text).get("url")
      : (JSON.parse(text) as { url?: unknown })?.url;
  } catch {
    url = undefined;
  }
  if (typeof url !== "string" || !url.trim() || url.length > MAX_URL_LENGTH)
    return fail(400, "invalid_url");

  const api = agentCheckApi();

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  const visitor = visitorAddress(request);
  if (api.key) {
    headers.authorization = `Bearer ${api.key}`;
    if (visitor) headers["x-farm-client-address"] = visitor;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${api.origin}/api/scans`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: url.trim() }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return fail(503, "unavailable", url);
  }

  const result = (await upstream.json().catch(() => ({}))) as { id?: unknown; error?: unknown };
  if (upstream.status === 429) {
    const code = typeof result.error === "string" ? result.error : "rate_limited";
    return fail(429, code, url, { "retry-after": upstream.headers.get("retry-after") ?? "300" });
  }
  if (!upstream.ok || typeof result.id !== "string") {
    return fail(
      upstream.ok ? 502 : upstream.status,
      typeof result.error === "string" ? result.error : "unavailable",
      url,
    );
  }
  const scan = await fetchAgentCheck(result.id).catch(() => null);
  // The scan ran but its report can't be read, so there is nothing to show.
  if (!scan) return fail(502, "unavailable", url);
  if (isForm) {
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    return new Response(null, {
      status: 303,
      headers: {
        location: new URL(agentCheckPath(scan.report.url), request.url).href,
        "set-cookie": `${AGENT_CHECK_REPORT_COOKIE}=${scan.id}; Path=/agents/check; Max-Age=${AGENT_CHECK_REPORT_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`,
      },
    });
  }
  return Response.json({ id: result.id, scan });
}
