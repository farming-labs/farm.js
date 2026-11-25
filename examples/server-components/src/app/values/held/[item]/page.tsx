import { Link } from "@farm.js/core/client";
import { WaitList } from "../../../../components/wait-list";

const entries = Array.from({ length: 40 }, (_, index) => `Waiting entry ${index}`);

// Pages that pass the same list to an island that waits for a click, so a navigation between them
// can run before islx loads.
export default async function ValuesHeldPage({
  params,
}: {
  params: { item: string } | Promise<{ item: string }>;
}) {
  const { item } = await params;
  return (
    <section>
      <h1>{`Held ${item}`}</h1>
      <WaitList entries={entries} />
      <Link href={item === "a" ? "/values/held/b" : "/values/held/a"} data-next>
        Next held
      </Link>
    </section>
  );
}
