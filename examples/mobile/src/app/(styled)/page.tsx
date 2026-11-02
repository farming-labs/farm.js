import { t } from "@farm.js/core/i18n/server";
import { Link } from "@farm.js/core/client";

export const ssg = true;

const demos = [
  { href: "/about", label: "Static page", note: "push" },
  { href: "/notes/1", label: "Dynamic route", note: "/notes/[id], push on this tab" },
  { href: "/notes/new", label: "Modal with a form", note: "server function, then push" },
  { href: "/navigation", label: "Navigation edge cases", note: "hash, back, forward, replace" },
  { href: "/docs/guide/tabs", label: "Catch-all docs", note: "/docs/[...slug]" },
  { href: "/feed", label: "Long list", note: "240 rows" },
  { href: "/stations/north", label: "Route loader", note: "data.main" },
  { href: "/map", label: "Native screen", note: "page.native.tsx" },
  { href: "/camera", label: "Android override", note: "page.android.tsx" },
  { href: "/settings/device", label: "Platform screen", note: "page.kt" },
  { href: "/lab/packing", label: "Analyzer: port", note: "portable elements only" },
  { href: "/lab/chart", label: "Analyzer: web", note: "canvas, table, window" },
] as const;

export default function HomePage() {
  return (
    <>
      <h1 className="page-title">{t("home.title")}</h1>
      <p className="meta">{t("home.lede")}</p>
      <ul className="list" data-testid="demos">
        {demos.map((demo) => (
          <li key={demo.href}>
            <Link className="row" href={demo.href}>
              <strong>{demo.label}</strong>
              <span>{demo.note}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="actions">
        {/* Another origin: a browser tab on the web, Custom Tabs in the Android shell. */}
        <a className="button secondary" href="https://farmjs.dev/docs/desktop" data-testid="external">
          Read the docs on farmjs.dev
        </a>
      </div>
    </>
  );
}
