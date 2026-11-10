import { fetchQuery } from "@farm.js/convex/server";
import { api } from "../../../convex/_generated/api";

export default async function AccountPage() {
  const user = await fetchQuery(api.auth.currentUser);
  return (
    <main className="page">
      <h1>Account</h1>
      <p data-testid="account-status">
        {user ? `Signed in as ${user.email}` : "You are signed out."}
      </p>
      <a href="/">Back</a>
    </main>
  );
}
