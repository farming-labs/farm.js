import { Link } from "@farm.js/core/client";
import { ThemeLabel } from "../../../../components/theme";
import { WaitList } from "../../../../components/wait-list";

const entries = Array.from({ length: 40 }, (_, index) => `Waiting entry ${index}`);

// Pages of a layout that hydrates as one root once clicked: nothing here needs it at load.
export default async function ContextWaitPage({
  params,
}: {
  params: { item: string } | Promise<{ item: string }>;
}) {
  const { item } = await params;
  return (
    <section>
      <h1>{`Waiting ${item}`}</h1>
      <ThemeLabel />
      <WaitList entries={entries} />
      <Link href={item === "a" ? "/context/wait/b" : "/context/wait/a"} data-next>
        Next item
      </Link>
    </section>
  );
}
