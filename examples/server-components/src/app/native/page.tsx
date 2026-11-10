import type { FarmMobilePageConfig } from "@farm.js/core/mobile";
import { addNativeNote, listNativeNotes } from "../../server/native-notes";
import { addNote } from "./actions";

export const dynamic = "force-dynamic";

// On mobile this page is drawn with native views (the build fails if it ever cannot be): a server
// component whose forms post server actions, which run on the server as a browser's would.
export const mobile = { native: true } satisfies FarmMobilePageConfig;

export default function NativePage() {
  async function addUrgent(formData: FormData) {
    "use server";
    const title = String(formData.get("title") ?? "").trim();
    if (title) addNativeNote(`${title} (urgent)`);
  }

  return (
    <section>
      <h1>Native notes</h1>
      <ul data-testid="native-notes">
        {listNativeNotes().map((note, index) => (
          <li key={index}>{note}</li>
        ))}
      </ul>
      <form action={addNote}>
        <input name="title" aria-label="Note" />
        <button type="submit">Add note</button>
      </form>
      <form action={addUrgent}>
        <input name="title" aria-label="Urgent note" />
        <button type="submit">Add urgent</button>
      </form>
    </section>
  );
}
