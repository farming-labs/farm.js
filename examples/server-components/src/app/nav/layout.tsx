import type { ReactNode } from "react";
import { Link } from "@farm.js/core/client";
import { Counter } from "../../components/counter";

export default function NavLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <Counter start={0} label="Layout clicks" />
      <Link href="/nav/a">Page A</Link> <Link href="/nav/b">Page B</Link>
      {children}
    </div>
  );
}
