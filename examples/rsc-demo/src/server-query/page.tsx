import { ServerQueryDemo } from "../components/ServerQueryDemo";

export default function ServerQueryPage() {
  return (
    <section className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase text-emerald-500">
          RSC regression application
        </p>
        <h1 className="text-3xl font-bold text-white">Unified server queries</h1>
        <p className="text-slate-400">
          Prefetch, browser SWR, request deduplication, and shared invalidation use one cache key.
        </p>
      </header>

      <ServerQueryDemo />
    </section>
  );
}
