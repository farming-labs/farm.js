import { ThemeLabel } from "../../../components/theme";
import { ThemeLater } from "../../../components/theme-later";

// The layout's provider read by a client component that hydrates at load and by one that declares
// a deferred strategy (contract.spec.ts).
export default function DeferredContextPage() {
  return (
    <section>
      <h1>Deferred context</h1>
      <ThemeLabel />
      <ThemeLater />
    </section>
  );
}
