"use client";
import { useOptimistic, useState, useTransition } from "react";

export function OptimisticLikes({ like }: { like: (count: number) => Promise<number> }) {
  const [likes, setLikes] = useState(0);
  const [optimistic, addOptimistic] = useOptimistic(likes, (value: number) => value + 1);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          startTransition(async () => {
            addOptimistic(undefined as never);
            setLikes(await like(likes));
          })
        }
      >
        Like
      </button>
      <output data-testid="likes">{`${optimistic}${pending ? " pending" : ""}`}</output>
    </>
  );
}
