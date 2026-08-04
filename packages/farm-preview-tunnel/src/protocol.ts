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
  headers: Record<string, string>;
  body?: string;
}

export interface TunnelErrorMessage {
  type: "error";
  id?: string;
  message: string;
}

export type AgentToRelayMessage = RegisterMessage | TunnelResponseMessage;
export type RelayToAgentMessage = ReadyMessage | TunnelRequestMessage | TunnelErrorMessage;

export function normalizePreviewName(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}
