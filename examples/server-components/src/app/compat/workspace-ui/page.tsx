import { WidgetPanel } from "@farm-fixtures/workspace-ui";

// A workspace package's server component that renders a client component package the app does
// not depend on: only the workspace package can resolve it, as in a pnpm monorepo.
export default function WorkspaceUiPage() {
  return (
    <section>
      <h1>workspace ui</h1>
      <WidgetPanel title="widget panel" />
    </section>
  );
}
