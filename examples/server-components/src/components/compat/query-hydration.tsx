"use client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function HydrationQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function HydratedTodo() {
  const { data } = useQuery({
    queryKey: ["todo"],
    queryFn: async () => ({ title: "fetched in the browser" }),
  });
  return <p data-testid="hydrated-todo">{data?.title ?? "loading"}</p>;
}
