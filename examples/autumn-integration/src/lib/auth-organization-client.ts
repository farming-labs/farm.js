"use client";

export interface AuthOrganizationRecord {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  createdAt?: string;
  metadata?: unknown;
}

export interface AuthOrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: string;
  user?: {
    id: string;
    email: string;
    name: string;
    image?: string | null;
  };
}

export interface AuthOrganizationInvitation {
  id: string;
  organizationId: string;
  email: string;
  role?: string | null;
  status: string;
  expiresAt: string;
  createdAt: string;
  inviterId: string;
  organizationName?: string | null;
}

export interface ActiveOrganizationRecord extends AuthOrganizationRecord {
  members: AuthOrganizationMember[];
  invitations: AuthOrganizationInvitation[];
}

type AuthResult<T> = {
  data: T | null;
  error: string | null;
};

async function authRequest<T>(path: string, init?: RequestInit): Promise<AuthResult<T>> {
  try {
    const headers = new Headers(init?.headers);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await fetch(`/api/auth${path}`, {
      credentials: "include",
      headers,
      ...init,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const errorMessage =
        payload && typeof payload === "object" && "message" in payload
          ? String(payload.message)
          : payload && typeof payload === "object" && "error" in payload
            ? String(payload.error)
            : `Request failed with status ${response.status}`;

      return {
        data: null,
        error: errorMessage,
      };
    }

    return {
      data: payload as T,
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Request failed unexpectedly",
    };
  }
}

export const authOrganizationClient = {
  list() {
    return authRequest<AuthOrganizationRecord[]>("/organization/list", {
      method: "GET",
    });
  },
  getFullOrganization() {
    return authRequest<ActiveOrganizationRecord>("/organization/get-full-organization", {
      method: "GET",
    });
  },
  listUserInvitations() {
    return authRequest<AuthOrganizationInvitation[]>("/organization/list-user-invitations", {
      method: "GET",
    });
  },
  create(input: {
    name: string;
    slug: string;
    keepCurrentActiveOrganization?: boolean;
  }) {
    return authRequest<AuthOrganizationRecord>("/organization/create", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  setActive(organizationId: string | null) {
    return authRequest<{ success?: boolean }>("/organization/set-active", {
      method: "POST",
      body: JSON.stringify({
        organizationId,
      }),
    });
  },
  acceptInvitation(invitationId: string) {
    return authRequest<{ invitation?: AuthOrganizationInvitation }>(
      "/organization/accept-invitation",
      {
        method: "POST",
        body: JSON.stringify({
          invitationId,
        }),
      },
    );
  },
};
