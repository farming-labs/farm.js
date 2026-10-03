import type { LayoutProps } from "@farm.js/core";
import { AnnouncementBar, SiteFooter, SiteHeader } from "../../components/site-chrome";
import "./blog.css";
import "../../components/blog/figures.css";

export default function BlogLayout({ children }: LayoutProps) {
  return (
    <div className="farm-home farm-blog min-h-screen overflow-x-clip bg-black font-sans text-white">
      <a className="blog-skip-link" href="#blog-content">
        Skip to content
      </a>
      <AnnouncementBar />
      <div className="farm-page-grid">
        <div aria-hidden className="farm-page-rail" />
        <div className="farm-page-content min-w-0">
          <SiteHeader activePage="blog" />
          <main id="blog-content" tabIndex={-1}>
            {children}
          </main>
          <SiteFooter />
        </div>
        <div aria-hidden className="farm-page-rail" />
      </div>
    </div>
  );
}
