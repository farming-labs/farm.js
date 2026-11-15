import { Link } from "@farm.js/core/client";

// A link to an element further down the page.
export default function HashPage() {
  return (
    <section>
      <h1>Hash</h1>
      <Link href="/next/hash#bottom">To the bottom</Link>
      <div style={{ height: "3000px" }} />
      <p id="bottom" data-testid="bottom">
        Bottom
      </p>
    </section>
  );
}
