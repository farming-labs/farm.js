import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "@farmjs/core/after";

interface AfterPageProps {
  searchParams: Record<string, string | undefined>;
}

const TOKEN_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

export default function AfterPage({ searchParams }: AfterPageProps) {
  const token = searchParams.token;
  const scheduledAt = Date.now();

  if (token && TOKEN_PATTERN.test(token)) {
    after(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await writeFile(
        join(tmpdir(), `farm-after-${token}.json`),
        JSON.stringify({ completedAt: Date.now(), scheduledAt, token }),
        "utf8",
      );
    });
  }

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-6 py-12">
      <h1 className="text-3xl font-bold text-white">Post-response work</h1>
      <p data-testid="after-status" className="text-slate-300">
        {token && TOKEN_PATTERN.test(token) ? "scheduled" : "missing token"}
      </p>
    </main>
  );
}

