import { Link } from "@farm.js/core/client";
import { Clicker } from "../../../components/battle/crash";

export const dynamic = "force-dynamic";

export default async function ListPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const count = Math.min(Number((await searchParams).n ?? "3") || 3, 60);
  return (
    <section>
      <h1>{`List of ${count}`}</h1>
      <nav>
        <Link href="/battle/list?n=3">Three</Link> <Link href="/battle/list?n=5">Five</Link>{" "}
        <Link href="/battle/list?n=40">Forty</Link>
      </nav>
      <ol>
        {Array.from({ length: count }, (_, index) => (
          <li key={index}>
            <Clicker name={`row-${index}`} />
          </li>
        ))}
      </ol>
    </section>
  );
}
