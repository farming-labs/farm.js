import { Tabs } from "../../../components/battle/slots";

async function ServerPanel({ name }: { name: string }) {
  await Promise.resolve();
  return <p data-testid="server-panel">{`panel ${name} rendered on the server`}</p>;
}

export default function SlotsPage() {
  return (
    <section>
      <h1>Slots</h1>
      <Tabs
        header={<strong data-testid="server-header">server header</strong>}
        panels={[<ServerPanel key="a" name="a" />, <ServerPanel key="b" name="b" />]}
      />
    </section>
  );
}
