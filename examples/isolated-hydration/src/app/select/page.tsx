import { OptionIsland } from "../../components/option-island";

export default function SelectPage() {
  return (
    <main>
      <h1 data-testid="select-title">Island in select context</h1>
      <select data-testid="select" defaultValue="alpha">
        <OptionIsland />
      </select>
    </main>
  );
}
