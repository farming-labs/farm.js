import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { HydratedTodo, HydrationQueryProvider } from "../../../components/compat/query-hydration";

export const dynamic = "force-dynamic";

// TanStack Query's server prefetch: QueryClient and dehydrate run on the server, HydrationBoundary
// is a client component, as in its docs for React Server Components.
export default async function QueryHydrationPage() {
  const client = new QueryClient();
  await client.prefetchQuery({
    queryKey: ["todo"],
    queryFn: async () => ({ title: "prefetched on the server" }),
  });
  return (
    <HydrationQueryProvider>
      <HydrationBoundary state={dehydrate(client)}>
        <HydratedTodo />
      </HydrationBoundary>
    </HydrationQueryProvider>
  );
}
