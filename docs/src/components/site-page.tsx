import type { ReactNode } from "react";
import { AnnouncementBar, IndexedLabel, SiteFooter, SiteHeader } from "./site-chrome";
// The design page's reading styles, and the blog's code panel for any code in the markdown.
import "../app/blog/blog.css";
import "../app/design/design.css";

/**
 * A plain reading page in the site chrome: /about, /contact, and /privacy. The content is the
 * route's page.md, which Farm also serves as raw markdown at the page's .md URL. The heading
 * here replaces the markdown's own title on the rendered page, as on /design, and the main
 * element keeps /design's id so its skip link and focus styles apply unchanged.
 */
export function SiteProsePage({
  children,
  index,
  label,
  title,
}: {
  children: ReactNode;
  index: string;
  label: string;
  title: string;
}) {
  return (
    <div className="farm-home farm-design min-h-screen overflow-x-clip bg-black font-sans text-white">
      <a className="design-skip-link" href="#design-content">
        Skip to content
      </a>
      <AnnouncementBar />
      <div className="farm-page-grid">
        <div aria-hidden className="farm-page-rail" />
        <div className="farm-page-content min-w-0">
          <SiteHeader />
          <main id="design-content" tabIndex={-1} className="design-main farm-full-rule">
            <header className="design-hero">
              <div className="text-white/42">
                <IndexedLabel index={index} label={label} />
              </div>
              <h1 className="mt-6 max-w-full text-[clamp(1.75rem,7.5vw,2.5rem)] font-medium leading-[1.07] tracking-[-0.055em] text-white min-[601px]:text-[clamp(40px,5vw,64px)]">
                {title}
              </h1>
            </header>
            <div className="design-prose">{children}</div>
          </main>
          <SiteFooter />
        </div>
        <div aria-hidden className="farm-page-rail" />
      </div>
    </div>
  );
}
