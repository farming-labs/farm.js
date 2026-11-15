import type { ForwardRequestInit } from "./types.js";

const DROPPED_REQUEST_HEADERS = ["connection", "content-length", "host", "transfer-encoding"];
const DROPPED_RESPONSE_HEADERS = ["content-encoding", "content-length", "transfer-encoding"];
const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

function readProtocol(url: URL): string {
  return url.protocol.replace(/:$/, "");
}

function createForwardHeaders(request: Request, incomingURL: URL): Headers {
  const headers = new Headers(request.headers);
  DROPPED_REQUEST_HEADERS.forEach((name) => headers.delete(name));
  headers.set("accept-encoding", "identity");
  headers.set("x-forwarded-host", incomingURL.host);
  headers.set("x-forwarded-proto", readProtocol(incomingURL));
  headers.set("x-better-auth-forwarded-host", incomingURL.host);
  headers.set("x-better-auth-forwarded-proto", readProtocol(incomingURL));
  return headers;
}

function copyResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  DROPPED_RESPONSE_HEADERS.forEach((name) => headers.delete(name));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function forwardRequest(
  request: Request,
  siteURL: string,
  targetPath?: string,
): Promise<Response> {
  const incomingURL = new URL(request.url);
  const pathname = targetPath ?? incomingURL.pathname;
  const targetURL = new URL(`${pathname}${incomingURL.search}`, siteURL);
  const init: ForwardRequestInit = {
    method: request.method,
    headers: createForwardHeaders(request, incomingURL),
    body: BODYLESS_METHODS.has(request.method) ? undefined : request.body,
    redirect: "manual",
    duplex: "half",
  };
  return copyResponse(await fetch(targetURL, init));
}
