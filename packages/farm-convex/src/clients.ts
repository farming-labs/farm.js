import { ConvexReactClient } from "convex/react";

const clientsByURL = new Map<string, ConvexReactClient>();

export function readConvexReactClient(url: string): ConvexReactClient {
  const existing = clientsByURL.get(url);
  if (existing) return existing;
  const client = new ConvexReactClient(url);
  clientsByURL.set(url, client);
  return client;
}
