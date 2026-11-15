import { headers } from "@farm.js/core/headers";
import { notFound } from "@farm.js/core/navigation";
import type { ReactNode } from "react";

export default async function GuardedLayout({ children }: { children: ReactNode }) {
  if ((await headers()).get("x-guard") !== "allow") notFound();
  return (
    <div>
      <p>Guarded layout</p>
      {children}
    </div>
  );
}
