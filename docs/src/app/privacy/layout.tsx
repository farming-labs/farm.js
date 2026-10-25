import type { LayoutProps } from "@farm.js/core";
import { SiteProsePage } from "../../components/site-page";

// The page content is page.md, which Farm also serves as raw markdown at /privacy.md.
export default function PrivacyLayout({ children }: LayoutProps) {
  return (
    <SiteProsePage index="00" label="Privacy" title="Privacy">
      {children}
    </SiteProsePage>
  );
}
