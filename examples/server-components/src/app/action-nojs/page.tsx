import { reserveSeat } from "./actions";

export const dynamic = "force-dynamic";

// Server actions posted without JavaScript, where the browser shows the response itself.
export default function ActionNoJsPage() {
  return (
    <section>
      <h1>Action without JavaScript</h1>
      <form action={reserveSeat}>
        <input name="seat" aria-label="Seat" defaultValue="12A" />
        <button type="submit">Reserve</button>
      </form>
    </section>
  );
}
