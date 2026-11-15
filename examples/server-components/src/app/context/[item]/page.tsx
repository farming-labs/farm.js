import { Link } from "@farm.js/core/client";
import { Clicker } from "../../../components/battle/crash";
import { ThemeLabel } from "../../../components/theme";

// Pages of one layout that hydrates as one React root: the next one updates the page on screen.
export default async function ContextItemPage({
  params,
}: {
  params: { item: string } | Promise<{ item: string }>;
}) {
  const { item } = await params;
  return (
    <section>
      <h1>{`Item ${item}`}</h1>
      <ThemeLabel />
      <Clicker name="item" />
      <Link href={item === "a" ? "/context/b" : "/context/a"} data-next>
        Next item
      </Link>
    </section>
  );
}
