import { SWRConfig } from "swr";
import { SwrUser } from "../../../components/compat/swr-user";

// SWR's server-components pattern: a server component passes fallback data through SWRConfig.
export default function SwrPage() {
  return (
    <section>
      <h1>SWR</h1>
      <SWRConfig value={{ fallback: { "/api/user": { name: "Ada from the server" } } }}>
        <SwrUser />
      </SWRConfig>
    </section>
  );
}
