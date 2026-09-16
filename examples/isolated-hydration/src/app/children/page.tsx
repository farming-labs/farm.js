import { ClientShell } from "../../components/client-shell";
import { catalogSeed } from "../../lib/server-data";

export default function ChildrenPage() {
  return (
    <main>
      <h1 data-testid="children-title">Client shell wrapping server content</h1>
      <ClientShell>
        <p data-testid="server-child">server-rendered child: {catalogSeed.length} items</p>
      </ClientShell>
    </main>
  );
}
