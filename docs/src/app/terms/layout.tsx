import type { LayoutProps } from "@farm.js/core";
import { SiteProsePage } from "../../components/site-page";

// The page content is page.md, which Farm also serves as raw markdown at /terms.md.
export default function TermsLayout({ children }: LayoutProps) {
  return (
    <SiteProsePage index="00" label="Terms" title="Terms">
      {children}
    </SiteProsePage>
  );
}
