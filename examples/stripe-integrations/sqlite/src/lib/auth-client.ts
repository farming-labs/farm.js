import { createAuthClient } from "better-auth/react";
import { organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

export const authClient = createAuthClient({
  fetchOptions: {
    credentials: "include",
  },
  plugins: [twoFactorClient(), passkeyClient(), organizationClient()],
});
