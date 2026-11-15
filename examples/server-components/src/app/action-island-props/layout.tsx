import type { ReactNode } from "react";
import { Counter } from "../../components/counter";
import { getPageCount } from "../../server/layout-count";

// Only the island's props depend on the count: the layout's own markup stays the same.
export default function ActionIslandPropsLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <Counter start={0} label={`Layout sees page ${getPageCount()}`} />
      {children}
    </div>
  );
}
