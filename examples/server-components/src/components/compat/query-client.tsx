"use client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function QueryCount() {
  const { data } = useQuery({ queryKey: ["count"], queryFn: async () => 42 });
  return <p data-testid="query-count">{`query: ${data ?? "loading"}`}</p>;
}
