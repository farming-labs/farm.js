import type { LayoutProps } from "@farm.js/core";
import { SiteProsePage } from "../../components/site-page";

// The page content is page.md, which Farm also serves as raw markdown at /contact.md.
export default function ContactLayout({ children }: LayoutProps) {
  return (
    <SiteProsePage index="00" label="Contact" title="Contact">
      {children}
    </SiteProsePage>
  );
}
