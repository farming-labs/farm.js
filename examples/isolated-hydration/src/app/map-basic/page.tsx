import { ListItemIsland } from "../../components/list-item-island";

const rows = ["alpha", "beta", "gamma"];

export default function MapBasicPage() {
  return (
    <main>
      <h1 data-testid="map-basic-title">Islands rendered through map</h1>
      <ul>
        {rows.map((row) => (
          <ListItemIsland key={row} name={row} />
        ))}
      </ul>
    </main>
  );
}
