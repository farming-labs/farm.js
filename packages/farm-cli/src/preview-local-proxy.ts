import {
  Agent as HttpAgent,
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
} from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { connect as netConnect, type AddressInfo, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import type { Duplex } from "node:stream";
import { createHttpLocalUrl } from "./local-url";
import type { PreviewTarget } from "./preview";

/** Same marker the hosted relay and polling client set; the dev server keys its preview guard on it. */
const PREVIEW_REQUEST_HEADER = "x-farm-preview";

const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

export interface PreviewMarkerProxy {
  /** Where the tunnel should point: the proxy, on loopback, with the app's mount path. */
  target: PreviewTarget;
  close(): Promise<void>;
}

/**
 * Fronts the app with a loopback proxy that marks every request as preview traffic.
 *
 * A local provider (cloudflared, localtunnel, FARM_PREVIEW_TUNNEL_COMMAND) forwards public
 * requests straight to the dev server, which cannot tell them from the developer's own browser.
 * The proxy sets `x-farm-preview: 1` after dropping any copy the visitor sent, so the dev preview
 * guard and devtools gate apply to the public URL the same way they do for `farm preview`'s own
 * relay. WebSocket upgrades (Vite HMR) are marked and piped through unchanged.
 */
export async function startPreviewMarkerProxy(target: PreviewTarget): Promise<PreviewMarkerProxy> {
  const upstream = new URL(target.localUrl);
  const secure = upstream.protocol === "https:";
  const upstreamHost = upstream.hostname.replace(/^\[|\]$/g, "");
  const upstreamPort = target.port;
  // Its own agent, so closing the proxy also closes its kept-alive connections to the app.
  const agent = secure ? new HttpsAgent({ keepAlive: true }) : new HttpAgent({ keepAlive: true });
  const sockets = new Set<Duplex>();
  const track = (socket: Duplex) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  };

  const server = createServer((req, res) => {
    const forward = (secure ? httpsRequest : httpRequest)(
      {
        agent,
        host: upstreamHost,
        port: upstreamPort,
        method: req.method,
        path: req.url,
        headers: markPreviewHeaders(req.headers),
      },
      (response) => {
        res.writeHead(response.statusCode || 502, response.statusMessage, response.rawHeaders);
        response.once("error", () => res.destroy());
        response.pipe(res);
      },
    );
    forward.on("error", () => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("The local app did not respond to farm preview.");
    });
    res.once("close", () => {
      if (!res.writableFinished) forward.destroy();
    });
    req.pipe(forward);
  });

  server.on("connection", track);
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const options = { host: upstreamHost, port: upstreamPort };
    const upstreamSocket: Socket = secure
      ? tlsConnect({ ...options, servername: upstreamHost })
      : netConnect(options);
    track(upstreamSocket);
    const fail = () => {
      socket.destroy();
      upstreamSocket.destroy();
    };
    upstreamSocket.once("error", fail);
    socket.once("error", fail);
    upstreamSocket.once(secure ? "secureConnect" : "connect", () => {
      upstreamSocket.write(serializeUpgradeRequest(req));
      if (head.length) upstreamSocket.write(head);
      socket.pipe(upstreamSocket).pipe(socket);
    });
    socket.once("close", () => upstreamSocket.destroy());
    upstreamSocket.once("close", () => socket.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;
  const mountPath = upstream.pathname === "/" ? "" : upstream.pathname.replace(/\/+$/, "");

  return {
    target: {
      ...target,
      localUrl: `${createHttpLocalUrl("127.0.0.1", port)}${mountPath}`,
      host: "127.0.0.1",
      port,
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        agent.destroy();
        server.close(() => resolve());
      }),
  };
}

/**
 * The request headers for the app, with hop-by-hop headers (and any header the client nominated
 * through `Connection`) removed and the preview marker set last, so a visitor can neither forge
 * another value nor get the marker stripped on the way.
 */
export function markPreviewHeaders(
  headers: IncomingHttpHeaders,
  options: { keepUpgrade?: boolean } = {},
): OutgoingHttpHeaders {
  const drop = new Set(HOP_BY_HOP_HEADERS);
  const connection = headers.connection;
  for (const value of Array.isArray(connection) ? connection : connection ? [connection] : []) {
    for (const name of value.split(",")) drop.add(name.trim().toLowerCase());
  }
  const next: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || drop.has(name) || name === PREVIEW_REQUEST_HEADER) continue;
    next[name] = value;
  }
  if (options.keepUpgrade && headers.upgrade) {
    next.connection = "Upgrade";
    next.upgrade = headers.upgrade;
  }
  next[PREVIEW_REQUEST_HEADER] = "1";
  return next;
}

function serializeUpgradeRequest(req: IncomingMessage) {
  const lines = [`${req.method} ${req.url} HTTP/1.1`];
  for (const [name, value] of Object.entries(
    markPreviewHeaders(req.headers, { keepUpgrade: true }),
  )) {
    for (const item of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${item}`);
  }
  return `${lines.join("\r\n")}\r\n\r\n`;
}
