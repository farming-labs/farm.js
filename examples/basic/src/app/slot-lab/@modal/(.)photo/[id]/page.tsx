"use client";

import { useRouter } from "@farm.js/core/client";

export default function PhotoModal({
  params,
}: {
  params: {
    id: string;
  };
}) {
  const router = useRouter();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${params.id}`}
      className="fixed inset-0 grid place-items-center bg-black/60 p-6"
      data-testid="intercepted-photo"
    >
      <article className="grid gap-4 rounded-lg bg-white p-6 text-slate-950">
        <h2>Intercepted photo {params.id}</h2>
        <button type="button" onClick={() => router.back()}>
          Close photo
        </button>
      </article>
    </div>
  );
}
