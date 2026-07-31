"use client";

import { createAuthClient } from "better-auth/react";
import type { FarmAuthClientOptions, FarmAuthCredentials, FarmAuthSignUpInput } from "./types.js";

export function createFarmAuthClient(options: FarmAuthClientOptions = {}) {
  const client = createAuthClient(options);

  function signIn(input: FarmAuthCredentials) {
    return client.signIn.email(input);
  }

  function signUp(input: FarmAuthSignUpInput) {
    return client.signUp.email(input);
  }

  function signOut() {
    return client.signOut();
  }

  function getSession() {
    return client.getSession();
  }

  function useAuth() {
    const state = client.useSession();

    return {
      user: state.data?.user ?? null,
      session: state.data?.session ?? null,
      isPending: state.isPending,
      isRefetching: state.isRefetching,
      error: state.error,
      refetch: state.refetch,
      signIn,
      signUp,
      signOut,
    };
  }

  return {
    signIn,
    signUp,
    signOut,
    getSession,
    useAuth,
  };
}

const defaultClient = createFarmAuthClient();

export const { getSession, signIn, signOut, signUp, useAuth } = defaultClient;

export type { FarmAuthClientOptions, FarmAuthCredentials, FarmAuthSignUpInput } from "./types.js";
