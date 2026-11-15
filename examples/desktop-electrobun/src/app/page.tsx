import { Notes } from "../components/notes";

export default function HomePage() {
  return (
    <main className="page">
      <header>
        <p className="eyebrow">Farm.js + Electrobun</p>
        <h1>Farm Notes</h1>
        <p className="lede">
          A Farm app served by its own production server on a random loopback port, inside a
          native window. Edit <code>src/components/notes.tsx</code> during <code>pnpm dev</code>{" "}
          and the window updates in place.
        </p>
      </header>
      <Notes />
    </main>
  );
}
