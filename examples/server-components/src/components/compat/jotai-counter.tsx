"use client";
import { atom, useAtom } from "jotai";

const countAtom = atom(0);

export function AtomCounter({ name }: { name: string }) {
  const [count, setCount] = useAtom(countAtom);
  return (
    <button type="button" data-testid={`atom-${name}`} onClick={() => setCount(count + 1)}>
      {`${name} atom: ${count}`}
    </button>
  );
}
