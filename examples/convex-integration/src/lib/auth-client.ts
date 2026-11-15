import { createAuthClient } from "better-auth/react";

// Better Auth's own client. It calls /api/auth on this app, which Farm forwards to Convex.
export const authClient = createAuthClient();
