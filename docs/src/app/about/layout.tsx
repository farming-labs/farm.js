import type { LayoutProps } from "@farm.js/core";
import { SiteProsePage } from "../../components/site-page";

// The page content is page.md, which Farm also serves as raw markdown at /about.md.
export default function AboutLayout({ children }: LayoutProps) {
  return (
    <SiteProsePage index="00" label="About" title="About Farm.js">
      {children}
    </SiteProsePage>
  );
}
