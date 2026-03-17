import { api } from "@farmjs/core/client";

export interface LocalDemoStatusResult {
  ok: true;
  integration: {
    category: string;
    type: string;
  };
  message: string;
  pathname: string;
  requestId: string;
  bootedAt: string;
  lastAction: string;
  timestamp: string;
}

export interface LocalDemoEchoInput {
  message: string;
}

export interface LocalDemoEchoResult {
  ok: true;
  message: string;
  uppercase: string;
  length: number;
  pathname: string;
  requestId: string;
  lastAction: string;
  timestamp: string;
}

export const localDemoClient = {
  status: api.get<LocalDemoStatusResult>("/api/local-demo/status", {
    responseFormat: "json",
  }),
  echo: api.post<LocalDemoEchoInput, LocalDemoEchoResult>("/api/local-demo/echo", {
    responseFormat: "json",
  }),
};
