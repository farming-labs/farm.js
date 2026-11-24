"use client";

import { useAction, useRouter, useServerQuery } from "farm-leaf/bindings";
import { useState } from "leaf";
import { plantCrop, plantedCount } from "../server/plant";

export default function HomePage() {
  const [count, setCount] = useState(0);
  // Each hook is backed by one of Farm's stores: push() is a client navigation, the action tracks
  // its call, and the query reads again when plantCrop invalidates its key.
  const router = useRouter();
  const plant = useAction(plantCrop);
  const total = useServerQuery(plantedCount, undefined);
  // A failed call lands in plant.error, which the page renders.
  const plantBarley = () => plant.submit({ name: "barley" }).catch(() => {});

  return (
    <section>
      <h1>leaf renders this page</h1>
      <p id="path">path: {router.pathname}</p>
      <button type="button" id="counter" onClick={() => setCount((n) => n + 1)}>
        Clicked {count} times
      </button>
      <button type="button" id="go-about" onClick={() => router.push("/about")}>
        Go to about
      </button>
      <button type="button" id="plant" disabled={plant.pending} onClick={plantBarley}>
        Plant barley
      </button>
      <p id="planted">{plant.data?.message ?? "Nothing planted yet."}</p>
      {plant.error && <p role="alert">{plant.error.message}</p>}
      <p id="planted-total">Planted so far: {total.data?.planted ?? "…"}</p>
    </section>
  );
}
