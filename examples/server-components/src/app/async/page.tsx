const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadItems(): Promise<string[]> {
  await wait(20);
  return ["first", "second"];
}

export default async function AsyncPage() {
  const items = await loadItems();
  return (
    <section>
      <h1>Async</h1>
      <ul>
        {items.map((item) => (
          <li key={item}>{`Loaded ${item}`}</li>
        ))}
      </ul>
    </section>
  );
}
