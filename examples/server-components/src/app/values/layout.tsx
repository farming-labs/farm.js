import type { ReactNode } from "react";
import { Link } from "@farm.js/core/client";
import { Picker, type PickerItem } from "../../components/picker";

// A large value two client components share, as a docs sidebar and its mobile menu do.
const items: PickerItem[] = Array.from({ length: 120 }, (_, index) => ({
  id: `item-${index}`,
  label: `Catalog entry ${index} with a description long enough to matter`,
}));

export default function ValuesLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <Picker items={items} label="Sidebar" />
      <Picker items={items} label="Menu" />
      <Link href="/values/a">Values A</Link> <Link href="/values/b">Values B</Link>
      {children}
    </div>
  );
}
