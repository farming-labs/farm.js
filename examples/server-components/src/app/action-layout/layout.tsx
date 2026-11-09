import type { ReactNode } from "react";
import { Counter } from "../../components/counter";
import { getLayoutCount } from "../../server/layout-count";

export default function ActionLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <p data-testid="layout-count">Layout count: {getLayoutCount()}</p>
      <input aria-label="Layout note" />
      <Counter start={0} label="Layout clicks" />
      {children}
    </div>
  );
}
