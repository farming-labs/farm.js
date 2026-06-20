
import { betterAuth } from "better-auth";

export const auth = betterAuth({
  secret: "farm-example-secret",
  baseURL: "http://localhost:3001",
  emailAndPassword: {
    enabled: true,
  },
});
