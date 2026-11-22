import type { Metadata } from "@farm.js/core";

export const metadata: Metadata = { title: "About leaf" };

// No "use client" and no `hydrate`: this page ships HTML and no JavaScript of its own.
export default function AboutPage() {
  return (
    <section>
      <h1>About leaf</h1>
      <p id="about">
        leaf is a small UI library that has never heard of Farm. The farm-leaf adapter tells Farm
        how to render it.
      </p>
    </section>
  );
}
