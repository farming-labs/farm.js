"use client";

import AuthScreen from "../auth-screen";

export default function SignInPage() {
  return (
    <AuthScreen
      mode="sign-in"
      initialReturnTo="/dashboard"
    />
  );
}
