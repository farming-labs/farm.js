import type { IncomingHttpHeaders } from "node:http";

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

export interface RecordingServer {
  url: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}
