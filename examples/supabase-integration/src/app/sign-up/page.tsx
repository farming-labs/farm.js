"use client";

import AuthScreen from "../auth-screen";

export default function SignUpPage() {
  return (
    <AuthScreen
      mode="sign-up"
      initialReturnTo="/dashboard"
    />
  );
}
