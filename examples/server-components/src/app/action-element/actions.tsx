"use server";
import { Counter } from "../../components/counter";

async function Total({ items }: { items: number }) {
  await new Promise((resolve) => setTimeout(resolve, 10));
  return <strong>{items} items</strong>;
}

// Returns elements, as an RSC action can: a server component that awaits, and a client component.
export async function summarize() {
  return (
    <p data-testid="action-element">
      Saved <Total items={3} /> <Counter start={1} label="Returned clicks" />
    </p>
  );
}
