import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "@farm.js/core/after";

const TOKEN = /^[a-zA-Z0-9_-]{1,80}$/;

// after() runs once the response has finished: the page is sent first, the marker written later.
export default async function AfterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Farm's page props: `searchParams` is a promise (the RSC engine passes the object, which
  // `await` returns as it is).
  const { token } = await searchParams;
  const scheduledAt = Date.now();
  if (typeof token === "string" && TOKEN.test(token)) {
    after(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await writeFile(
        join(tmpdir(), `farm-contract-after-${token}.json`),
        JSON.stringify({ token, scheduledAt, completedAt: Date.now() }),
      );
    });
  }
  return (
    <section>
      <h1>After</h1>
      <p data-testid="after-status">{typeof token === "string" && TOKEN.test(token) ? "scheduled" : "missing token"}</p>
    </section>
  );
}
