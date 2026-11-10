import Balancer from "react-wrap-balancer";
import { BalancedFromClient } from "../../../components/compat/balancer";

// react-wrap-balancer ships its ES module build only through `module`, beside a CommonJS `main`.
export default function BalancerPage() {
  return (
    <section>
      <h2 data-testid="balancer-server">
        <Balancer>A balanced headline rendered by a server component</Balancer>
      </h2>
      <BalancedFromClient />
    </section>
  );
}
