import {
  ClientItem,
  ClientOption,
  ClientRow,
  ClientShape,
} from "../../../components/battle/structure";

export default function StructurePage() {
  return (
    <section>
      <h1>Structure</h1>
      <ul data-testid="list">
        <ClientItem label="first" />
      </ul>
      <table data-testid="table">
        <tbody>
          <ClientRow label="alpha" />
          <ClientRow label="beta" />
        </tbody>
      </table>
      <label htmlFor="flavor">Flavor</label>
      <select id="flavor" data-testid="select" defaultValue="vanilla">
        <ClientOption value="vanilla" />
        <ClientOption value="mint" />
      </select>
      <svg data-testid="svg" viewBox="0 0 20 20" width="40" height="40">
        <ClientShape />
      </svg>
    </section>
  );
}
