"use client";

import PrefetchLab from "./prefetch-lab";

export default function PrefetchE2EPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold">Link Prefetch Controls</h1>
      <PrefetchLab />
    </main>
  );
}
