export async function generateMetadata() {
  return { title: "Contract meta 42", description: "Metadata from generateMetadata" };
}

export default function MetaPage() {
  return <h1>Meta</h1>;
}
