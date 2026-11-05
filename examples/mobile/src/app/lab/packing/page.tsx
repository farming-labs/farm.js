"use client";

import { Link } from "@farm.js/core/client";
import { useState } from "react";

/**
 * Written only with elements and inline styles that have native counterparts, with a controlled
 * input and a rendered list, so `farm config inspect --mobile --report` says "port".
 */
export default function PackingPage() {
  const [items, setItems] = useState(["Headlamp", "Water filter", "Map"]);
  const [draft, setDraft] = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: "700" }}>Packing list</h1>
      <p style={{ color: "#555555" }}>{items.length} items</p>
      <input
        value={draft}
        placeholder="Add an item"
        onChange={(event) => setDraft(event.target.value)}
        style={{ padding: 8, borderWidth: 1, borderColor: "#cccccc", borderRadius: 6 }}
      />
      <button
        onClick={() => {
          if (draft.trim()) setItems([...items, draft.trim()]);
          setDraft("");
        }}
        style={{ padding: 10, borderRadius: 6, backgroundColor: "#1f6f43", color: "#ffffff" }}
      >
        Add
      </button>
      <ul style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((item) => (
          <li key={item} style={{ padding: 8, borderBottomWidth: 1, borderColor: "#eeeeee" }}>
            {item}
          </li>
        ))}
      </ul>
      <Link href="/" style={{ color: "#1f6f43" }}>
        Home
      </Link>
    </div>
  );
}
