import { Suspense, type ReactNode } from "react";
import { Counter } from "../../components/counter";
import { getLayoutCount } from "../../server/layout-count";

async function LayoutNote() {
  await new Promise((resolve) => setTimeout(resolve, 150));
  return <p data-testid="layout-streamed">Streamed note</p>;
}

export default function ActionLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <p data-testid="layout-count">Layout count: {getLayoutCount()}</p>
      <input aria-label="Layout note" />
      <Counter start={0} label="Layout clicks" />
      <Suspense fallback={<p>Loading note</p>}>
        <LayoutNote />
      </Suspense>
      {children}
    </div>
  );
}
