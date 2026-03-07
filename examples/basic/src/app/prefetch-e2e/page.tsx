import type { PageProps } from "@farmjs/core";
import PrefetchLab from "./prefetch-lab";

export const metadata = {
  title: "Prefetch E2E - Basic Example",
  description: "Prefetch control test page for Link behavior.",
};

export default function PrefetchE2EPage(_props: PageProps) {
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold">Link Prefetch Controls</h1>
      <PrefetchLab />
    </main>
  );
}
