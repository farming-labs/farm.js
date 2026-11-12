import type { ReactNode } from "react";
import { Link } from "@farm.js/core/client";
import { Counter } from "../../components/counter";

export default function NavClientLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <Counter start={0} label="Client layout clicks" />
      <Link href="/nav-client/b">Server page</Link>
      {children}
    </div>
  );
}
