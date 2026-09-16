import { SvgIsland } from "../../components/svg-island";

export default function SvgPage() {
  return (
    <main>
      <h1 data-testid="svg-title">Island in SVG context</h1>
      <svg data-testid="svg" width="100" height="100" viewBox="0 0 100 100">
        <SvgIsland />
      </svg>
    </main>
  );
}
