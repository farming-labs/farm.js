import { ListItemIsland } from "../../components/list-item-island";

const rows = ["one", "two", "three"];

// The island count is still data-dependent, but it is produced by a helper and
// by filter().map() rather than a bare .map on the returned JSX.
function renderRows(names: string[]) {
  const nodes = [];
  for (const name of names) {
    nodes.push(<ListItemIsland key={name} name={name} />);
  }
  return nodes;
}

export default function MapHelperPage() {
  return (
    <main>
      <h1 data-testid="map-helper-title">Islands rendered through a helper</h1>
      <ul>{renderRows(rows.filter((name) => name.length > 0))}</ul>
    </main>
  );
}
