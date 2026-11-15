import { Link } from "@farm.js/core/client";
import { NavigationProbe } from "./navigation-probe";

/**
 * Navigations a `--mobile` client offers to the shell through delegateNavigation (Link, plain
 * same-origin anchors, navigateTo, router push and replace) next to the ones it never offers
 * (same-page hash links, back and forward, document navigations).
 */
export default function NavigationPage() {
  return (
    <>
      <h1 className="page-title">Navigation</h1>
      <NavigationProbe />
      <h2>Offered to the shell</h2>
      <ul className="list">
        <li>
          <Link className="row" href="/about" data-testid="nav-link">
            <strong>Link push</strong>
            <span>/about</span>
          </Link>
        </li>
        <li>
          <Link className="row" href="/navigation?filter=recent" data-testid="nav-query">
            <strong>Same route, new query</strong>
            <span>/navigation?filter=recent</span>
          </Link>
        </li>
        <li>
          <Link className="row" href="/navigation?filter=replaced" replace data-testid="nav-replace">
            <strong>Link replace</strong>
            <span>renders in place in the shell</span>
          </Link>
        </li>
        <li>
          <a className="row" href="/docs/guide" data-testid="nav-anchor">
            <strong>Plain anchor</strong>
            <span>/docs/guide, taken by the router</span>
          </a>
        </li>
        <li>
          <Link className="row" href="/navigation/step/1" data-testid="nav-wizard">
            <strong>Wizard</strong>
            <span>steps use presentation: replace</span>
          </Link>
        </li>
      </ul>
      <h2>Not offered</h2>
      <ul className="list">
        <li>
          <a className="row" href="#later" data-testid="nav-hash">
            <strong>Hash link</strong>
            <span>scrolls this page</span>
          </a>
        </li>
        <li>
          <a className="row" href="/api/notes" data-testid="nav-document">
            <strong>Not a page</strong>
            <span>/api/notes, a document load</span>
          </a>
        </li>
      </ul>
      <div style={{ height: 900 }} />
      <h2 id="later" data-testid="later">
        Later on this page
      </h2>
      <p>The hash link scrolled here without a visit.</p>
    </>
  );
}
