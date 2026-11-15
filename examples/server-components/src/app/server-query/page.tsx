import { ProductQueries } from "../../components/server-fns";

export const metadata = { title: "Contract server queries" };

export default function ServerQueryPage() {
  return (
    <section>
      <h1>Server queries</h1>
      <ProductQueries />
    </section>
  );
}
