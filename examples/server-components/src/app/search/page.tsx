import type { PageProps } from "@farm.js/core";

// The query read without await, as an RSC page does, and with it, as Farm's contract types it.
export default async function SearchPage({ searchParams }: PageProps) {
  const awaited = await searchParams;
  return (
    <section>
      <h1>Search</h1>
      <p data-testid="search-direct">{String(searchParams.token ?? "none")}</p>
      <p data-testid="search-awaited">{String(awaited.token ?? "none")}</p>
    </section>
  );
}
