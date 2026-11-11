import { Link } from "@farm.js/core/client";
import NavigationLoadingCounter from "./counter";

// Enough server markup that React's stream renderer would otherwise outline the
// page's loading boundary (its progressive chunk size is 12.8 KB).
const ROWS = Array.from({ length: 120 }, (_, index) => index + 1);

export function NavigationLoadingContent({
  name,
  next,
}: {
  name: "first" | "second";
  next: "/navigation-loading/first" | "/navigation-loading/second";
}) {
  return (
    <section className="space-y-4" data-testid={`navigation-loading-${name}`}>
      <h1 className="text-2xl font-bold">Navigation loading: {name}</h1>
      <nav className="flex gap-4">
        <Link href={next} data-testid="navigation-loading-link">
          Go to the other page
        </Link>
        <a href={next} data-testid="navigation-loading-anchor">
          Plain anchor to the other page
        </a>
      </nav>
      <NavigationLoadingCounter label={name} />
      <ul className="grid gap-1 text-sm text-gray-600">
        {ROWS.map((row) => (
          <li key={row} className="rounded border border-gray-100 bg-white px-3 py-1">
            Row {row} of the {name} page, rendered on the server so the fragment is large.
          </li>
        ))}
      </ul>
    </section>
  );
}
