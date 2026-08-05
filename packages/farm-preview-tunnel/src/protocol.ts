export interface RegisterMessage {
  type: "register";
  name: string;
}

export interface ReadyMessage {
  type: "ready";
  sessionId: string;
  publicUrl: string;
}

export interface TunnelRequestMessage {
  type: "request";
  id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

export interface TunnelResponseMessage {
  type: "response";
  id: string;
  status: number;
  headers: Record<string, string | string[]>;
  body?: string;
}

export interface TunnelErrorMessage {
  type: "error";
  id?: string;
  message: string;
}

export type AgentToRelayMessage = RegisterMessage | TunnelResponseMessage;
export type RelayToAgentMessage = ReadyMessage | TunnelRequestMessage | TunnelErrorMessage;

export function isAgentToRelayMessage(value: unknown): value is AgentToRelayMessage {
  if (!isRecord(value)) return false;
  if (value.type === "register") return typeof value.name === "string";
  return value.type === "response" && isTunnelResponseMessage(value);
}

export function isRelayToAgentMessage(value: unknown): value is RelayToAgentMessage {
  if (!isRecord(value)) return false;
  if (value.type === "ready") {
    return typeof value.sessionId === "string" && typeof value.publicUrl === "string";
  }
  if (value.type === "error") {
    return (
      (value.id === undefined || typeof value.id === "string") && typeof value.message === "string"
    );
  }
  return value.type === "request" && isTunnelRequestMessage(value);
}

export function normalizePreviewName(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

function isTunnelRequestMessage(value: Record<string, unknown>) {
  return (
    typeof value.id === "string" &&
    typeof value.method === "string" &&
    typeof value.path === "string" &&
    isHeaders(value.headers, false) &&
    (value.body === undefined || typeof value.body === "string")
  );
}

function isTunnelResponseMessage(value: Record<string, unknown>) {
  return (
    typeof value.id === "string" &&
    Number.isInteger(value.status) &&
    (value.status as number) >= 100 &&
    (value.status as number) <= 599 &&
    isHeaders(value.headers, true) &&
    (value.body === undefined || typeof value.body === "string")
  );
}

function isHeaders(value: unknown, allowArrays: boolean) {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([name, header]) =>
      isHeaderName(name) &&
      (isHeaderValue(header) ||
        (allowArrays && Array.isArray(header) && header.every(isHeaderValue))),
  );
}

function isHeaderName(value: string) {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value);
}

function isHeaderValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !value.includes("\0") &&
    !value.includes("\r") &&
    !value.includes("\n")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
