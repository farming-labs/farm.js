/** Guards in page.tsx and layout.tsx run only when the page renders. */
export const GUARDED_SOURCE_FILES: Record<string, string> = {
  "src/app/layout.tsx":
    "export default function Layout({ children }) { return <main>{children}</main>; }",
  "src/app/page.tsx": "export default function Page() { return <p>home</p>; }",
  "src/app/staff/layout.tsx": `import { cookies } from "@farm.js/core/headers";
import { redirect } from "@farm.js/core/navigation";
export default async function Layout({ children }) {
  if (!(await cookies()).has("session")) redirect("/sign-in");
  return <section>{children}</section>;
}
`,
  "src/app/staff/page.md": "# Staff\n\nSTAFF-ONLY-SOURCE\n",
  "src/app/ledger/page.tsx": `import { cookies } from "@farm.js/core/headers";
import { redirect } from "@farm.js/core/navigation";
export default async function Page() {
  if (!(await cookies()).has("session")) redirect("/sign-in");
  return <p>ledger</p>;
}
`,
  "src/app/ledger/page.md": "# Ledger\n\nLEDGER-ONLY-SOURCE\n",
  "src/app/open/page.md": "# Open\n\nOPEN-SOURCE\n",
};

/**
 * Guards that let an anonymous render answer 200: a redirect() under a loading
 * boundary (the shell already streamed) in a layout or in the page itself, and a
 * layout that shows a sign-in prompt instead of its children.
 */
const lateGate = `import { Suspense } from "react";
import { cookies } from "@farm.js/core/headers";
import { redirect } from "@farm.js/core/navigation";
async function Gate({ children }) {
  const signedIn = (await cookies()).has("session");
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (!signedIn) redirect("/sign-in");
  return children;
}`;

export const LATE_GUARDED_SOURCE_FILES: Record<string, string> = {
  "src/app/streamed/layout.tsx": `${lateGate}
export default function Layout({ children }) {
  return <Suspense fallback={<p>loading</p>}><Gate>{children}</Gate></Suspense>;
}
`,
  "src/app/streamed/page.md": "# Streamed\n\nSTREAMED-ONLY-SOURCE\n",
  "src/app/vault/page.tsx": `${lateGate}
export default function Page() {
  return <Suspense fallback={<p>loading</p>}><Gate><p>vault</p></Gate></Suspense>;
}
`,
  "src/app/vault/page.md": "# Vault\n\nVAULT-ONLY-SOURCE\n",
  "src/app/club/layout.tsx": `import { cookies } from "@farm.js/core/headers";
export default async function Layout({ children }) {
  if (!(await cookies()).has("session")) return <p>Please sign in</p>;
  return <section>{children}</section>;
}
`,
  "src/app/club/page.md": "# Club\n\nCLUB-ONLY-SOURCE\n",
};

export const LATE_GUARDED_PAGES = [
  ["/streamed", "STREAMED-ONLY-SOURCE"],
  ["/vault", "VAULT-ONLY-SOURCE"],
  ["/club", "CLUB-ONLY-SOURCE"],
] as const;
