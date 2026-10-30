"use client";
import { useState } from "react";

export interface PickerItem {
  id: string;
  label: string;
}

export function Picker({ items, label }: { items: PickerItem[]; label: string }) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <section aria-label={label}>
      <p>{`${label}: ${items.length} items, ${selected.length} selected`}</p>
      <button type="button" onClick={() => setSelected([...selected, items[selected.length]!.id])}>
        {`Select in ${label}`}
      </button>
    </section>
  );
}
