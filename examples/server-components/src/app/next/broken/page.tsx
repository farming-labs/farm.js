export const dynamic = "force-dynamic";

// A server component that fails while rendering: the nearest error.tsx handles it.
export default function BrokenPage(): never {
  throw new Error("broken page failed");
}
