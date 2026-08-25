import { Bench } from "../components/bench";

export default function BenchmarkPage() {
  return (
    <main data-benchmark-marker="compiler-benchmark-v1">
      <h1>Farm.js compiler benchmark fixture</h1>
      <Bench />
    </main>
  );
}
