import { preloadQuery } from "@farm.js/convex/server";
import { api } from "../../convex/_generated/api";
import { Messages } from "../components/Messages";

export default async function HomePage() {
  const messages = await preloadQuery(api.messages.list);
  return (
    <main className="page">
      <h1>Convex on Farm</h1>
      <p>
        The messages below were loaded on the server, then stay live in the browser. Open two tabs
        and send a message to see it appear in both.
      </p>
      <Messages preloaded={messages} />
      <nav>
        <a href="/account">Account</a> · <a href="/sign-in">Sign in</a>
      </nav>
    </main>
  );
}
