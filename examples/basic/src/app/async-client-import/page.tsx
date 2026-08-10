import React from "react";
import { StarButton } from "./star-button";

// An async server page that imports a "use client" component. React cannot
// hydrate async components in the browser, so Farm must keep this route
// server-rendered instead of blanking the page and looping its data fetches.
// e2e coverage asserts the server HTML survives after load.
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
