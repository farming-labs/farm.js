import DefaultExportCounter from "./default-export-counter";
import { NamedExportCounter } from "./named-export-counter";

export default function HmrE2EPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold">Client component HMR</h1>
      <NamedExportCounter />
      <DefaultExportCounter />
    </main>
  );
}
