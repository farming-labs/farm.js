import type { ReactNode } from "react";
import { MobileNav } from "../../components/mobile-nav";
import { Sidebar } from "../../components/sidebar";
import { tree } from "../../data";

// Like most docs sites, the tree goes to two client components: the desktop sidebar and the
// mobile drawer.
export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="docs">
      <MobileNav tree={tree} />
      <Sidebar tree={tree} />
      <main>{children}</main>
    </div>
  );
}
