import { Collapsible } from "../../components/collapsible";

function ServerList() {
  const items = ["alpha", "beta", "gamma"];
  return (
    <ul>
      {items.map((item) => (
        <li key={item}>{`Server item ${item}`}</li>
      ))}
    </ul>
  );
}

export default function ChildrenPage() {
  return (
    <section>
      <h1>Children</h1>
      <Collapsible title="Toggle list">
        <ServerList />
      </Collapsible>
    </section>
  );
}
