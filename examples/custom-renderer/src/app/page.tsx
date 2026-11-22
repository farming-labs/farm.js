"use client";

import { useRouter } from "farm-leaf/bindings";
import { useState } from "leaf";
import { apiClient } from "../lib/api";

export default function HomePage() {
  const [count, setCount] = useState(0);
  const [planted, setPlanted] = useState("Nothing planted yet.");
  // Backed by Farm's router store, so push() is a client navigation.
  const router = useRouter();

  const plant = async () => {
    const result = await apiClient.plant.post({ body: { name: "barley" } });
    setPlanted(result.data ? result.data.message : "The server call failed.");
  };

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
      <button type="button" id="plant" onClick={plant}>
        Plant barley
      </button>
      <p id="planted">{planted}</p>
    </section>
  );
}
