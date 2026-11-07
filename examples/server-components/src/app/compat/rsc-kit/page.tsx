import { KitProvider, KitQuote, KitValue, kitGreeting } from "@farm-fixtures/rsc-kit";
import { KitLabel } from "../../../components/compat/kit-label";

// A package with a react-server build, used from a server component as React Server Components
// resolve it: its server component and server-only helper, and its "use client" provider.
export default function RscKitPage() {
  return (
    <section>
      <h1>rsc-kit</h1>
      <p data-testid="kit-greeting">{kitGreeting("islands")}</p>
      <KitQuote topic="engines" />
      <KitProvider initial="from server">
        <article>
          <p>Server text inside the kit provider.</p>
          <KitValue />
        </article>
      </KitProvider>
      <KitLabel />
    </section>
  );
}
