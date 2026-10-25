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
