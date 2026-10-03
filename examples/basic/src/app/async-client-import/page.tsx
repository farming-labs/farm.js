import React from "react";
import { StarButton } from "./star-button";

// An async server page that imports a "use client" component. React cannot
// run an async component in the browser, so the page itself stays server-only
// and Farm hydrates StarButton as its own island. e2e coverage asserts the
// server HTML survives and the button is interactive.
export default async function AsyncClientImportPage() {
  const stars = await Promise.resolve(42);

  return (
    <div style={{ padding: "2rem" }}>
      <h1 data-testid="async-page-title">Async server page</h1>
      <p data-testid="async-page-data">Fetched stars: {stars}</p>
      <StarButton initialCount={stars} />
    </div>
  );
}
