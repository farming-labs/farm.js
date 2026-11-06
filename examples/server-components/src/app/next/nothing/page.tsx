import { NothingClient } from "../../../components/nothing";

function NullServer() {
  return null;
}

function UndefinedServer() {
  return undefined;
}

// Components that render nothing, on the server and in the browser.
export default function NothingPage() {
  return (
    <section>
      <h1>Nothing</h1>
      <NullServer />
      <UndefinedServer />
      <NothingClient />
      <p data-testid="after-nothing">Still renders</p>
    </section>
  );
}
