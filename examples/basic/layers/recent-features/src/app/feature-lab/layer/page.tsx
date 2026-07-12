export default function RecentFeaturesLayerPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-6 py-12">
      <p className="text-sm font-semibold uppercase text-emerald-700">Farm layer</p>
      <h1 className="text-3xl font-bold text-slate-950">Layer route is active</h1>
      <p data-testid="layer-route" className="text-slate-700">
        This page is contributed by the local recent-features layer.
      </p>
    </main>
  );
}
