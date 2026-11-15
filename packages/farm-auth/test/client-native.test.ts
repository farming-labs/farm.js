import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ serverFetch: vi.fn(), signOut: vi.fn(), shellSignIn: vi.fn() }));
vi.mock("@farm.js/native", () => ({ serverFetch: native.serverFetch, signOut: native.signOut }));
vi.mock("@farm.js/native/internal", () => ({ shellSignIn: native.shellSignIn }));

// useSyncExternalStore without a renderer: the test subscribes the way React does after a commit.
const store = vi.hoisted(() => ({
  subscribe: undefined as undefined | ((listener: () => void) => () => void),
}));
vi.mock("react", () => ({
  useSyncExternalStore(
    subscribe: (listener: () => void) => () => void,
    getSnapshot: () => unknown,
  ) {
    store.subscribe = subscribe;
    return getSnapshot();
  },
}));

const { createFarmAuthClient } = await import("../src/client.native");

const SESSION = {
  user: {
    id: "u1",
    email: "ada@example.com",
    name: "Ada",
    emailVerified: false,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
  },
  session: {
    id: "s1",
    userId: "u1",
    token: "t",
    expiresAt: "2026-11-08T10:00:00.000Z",
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
  },
};

const json = (body: unknown, status = 200, statusText = "") =>
  new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "content-type": "application/json" },
  });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  native.serverFetch.mockReset();
  native.signOut.mockReset();
  native.signOut.mockResolvedValue(undefined);
  native.shellSignIn.mockReset();
  store.subscribe = undefined;
});

describe("getSession on native screens", () => {
  it("reads the session route through serverFetch, with Dates as on the web", async () => {
    native.serverFetch.mockResolvedValue(json(SESSION));
    const result = await createFarmAuthClient().getSession();

    expect(native.serverFetch).toHaveBeenCalledWith("/api/auth/get-session", { method: "GET" });
    expect(result.error).toBeNull();
    expect(result.data?.user.email).toBe("ada@example.com");
    expect(result.data?.user.createdAt).toEqual(new Date("2026-11-01T10:00:00.000Z"));
    expect(result.data?.session.expiresAt).toBeInstanceOf(Date);
  });

  it("returns the web client's signed-out result for a null session", async () => {
    native.serverFetch.mockResolvedValue(json(null));
    expect(await createFarmAuthClient().getSession()).toEqual({ data: null, error: null });
  });

  it("returns the same signed-out result when the device token is refused", async () => {
    native.serverFetch.mockResolvedValue(json({ message: "Unauthorized" }, 401, "Unauthorized"));
    expect(await createFarmAuthClient().getSession()).toEqual({ data: null, error: null });
  });

  it("returns other failures as Better Auth's client does", async () => {
    native.serverFetch.mockResolvedValue(
      json({ code: "FAILED", message: "Database down" }, 500, "Internal Server Error"),
    );
    expect(await createFarmAuthClient().getSession()).toEqual({
      data: null,
      error: {
        code: "FAILED",
        message: "Database down",
        status: 500,
        statusText: "Internal Server Error",
      },
    });
  });

  it("uses a custom basePath, normalized as the server mounts it", async () => {
    native.serverFetch.mockResolvedValue(json(null));
    await createFarmAuthClient({ basePath: "account/auth/" }).getSession();
    expect(native.serverFetch).toHaveBeenCalledWith("/account/auth/get-session", {
      method: "GET",
    });
  });

  it("rejects instead of throwing before a native screen has rendered", async () => {
    native.serverFetch.mockImplementation(() => {
      throw new Error("serverUrl() is available once a native screen renders.");
    });
    await expect(createFarmAuthClient().getSession()).rejects.toThrow(/native screen renders/);
  });
});

describe("signOut on native screens", () => {
  it("ends the server session, then forgets the device", async () => {
    const order: string[] = [];
    native.serverFetch.mockImplementation(async () => {
      order.push("server");
      return json({ success: true });
    });
    native.signOut.mockImplementation(async () => {
      order.push("device");
    });

    const result = await createFarmAuthClient().signOut();

    expect(native.serverFetch).toHaveBeenCalledWith("/api/auth/sign-out", { method: "POST" });
    expect(order).toEqual(["server", "device"]);
    expect(result).toEqual({ data: { success: true }, error: null });
  });

  it("still forgets the device when the server refuses, and returns the error", async () => {
    native.serverFetch.mockResolvedValue(
      json({ message: "Database down" }, 500, "Internal Server Error"),
    );
    const result = await createFarmAuthClient().signOut();

    expect(native.signOut).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      data: null,
      error: { message: "Database down", status: 500, statusText: "Internal Server Error" },
    });
  });

  it("still forgets the device when offline, and rethrows the network error", async () => {
    const offline = new TypeError("Network request failed");
    native.serverFetch.mockRejectedValue(offline);

    await expect(createFarmAuthClient().signOut()).rejects.toBe(offline);
    expect(native.signOut).toHaveBeenCalledTimes(1);
  });

  it("surfaces the device step's error when only that fails", async () => {
    native.serverFetch.mockResolvedValue(json({ success: true }));
    const stuck = new Error("Keystore unavailable");
    native.signOut.mockRejectedValue(stuck);

    await expect(createFarmAuthClient().signOut()).rejects.toBe(stuck);
  });

  it("keeps the server's error when both steps fail", async () => {
    const offline = new TypeError("Network request failed");
    native.serverFetch.mockRejectedValue(offline);
    native.signOut.mockRejectedValue(new Error("Keystore unavailable"));

    await expect(createFarmAuthClient().signOut()).rejects.toBe(offline);
  });
});

// What the shell resolves with: the auth route's status and its body as text.
const reply = (body: unknown, status = 200) => ({ status, body: JSON.stringify(body) });

const SIGNED_IN = { redirect: false, token: "t", url: undefined, user: SESSION.user };

describe("signIn and signUp on native screens", () => {
  it("signs in through the shell with the web client's route and body", async () => {
    native.shellSignIn.mockResolvedValue(reply(SIGNED_IN));
    native.serverFetch.mockResolvedValue(json(SESSION));
    const client = createFarmAuthClient();
    const input = { email: "ada@example.com", password: "secret", rememberMe: false };

    const result = await client.signIn(input);

    expect(native.shellSignIn).toHaveBeenCalledWith("/api/auth/sign-in/email", input);
    expect(result.error).toBeNull();
    expect(result.data?.user.email).toBe("ada@example.com");
    expect(result.data?.user.createdAt).toEqual(new Date("2026-11-01T10:00:00.000Z"));
    expect(result.data?.token).toBe("t");
  });

  it("returns a wrong password as Better Auth's client does, and loads no session", async () => {
    native.shellSignIn.mockResolvedValue(
      reply({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, 401),
    );
    const client = createFarmAuthClient();

    const result = await client.signIn({ email: "ada@example.com", password: "wrong" });

    expect(result).toEqual({
      data: null,
      error: {
        code: "INVALID_EMAIL_OR_PASSWORD",
        message: "Invalid email or password",
        status: 401,
        statusText: "",
      },
    });
    expect(native.serverFetch).not.toHaveBeenCalled();
  });

  it("signs up through the shell, and returns a taken email as the web client does", async () => {
    native.shellSignIn.mockResolvedValueOnce(reply({ token: "t", user: SESSION.user }));
    native.serverFetch.mockResolvedValue(json(SESSION));
    const client = createFarmAuthClient({ basePath: "/account/auth" });
    const input = { email: "ada@example.com", password: "secret12", name: "Ada" };

    const created = await client.signUp(input);
    expect(native.shellSignIn).toHaveBeenCalledWith("/account/auth/sign-up/email", input);
    expect(created.error).toBeNull();
    expect(created.data?.user.id).toBe("u1");

    native.shellSignIn.mockResolvedValueOnce(
      reply(
        {
          code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
          message: "User already exists. Use another email.",
        },
        422,
      ),
    );
    const taken = await client.signUp(input);
    expect(taken.data).toBeNull();
    expect(taken.error).toMatchObject({
      code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
      status: 422,
    });
  });

  it("rejects with the shell's error when the phone is offline", async () => {
    const offline = new Error("The server could not be reached: timeout");
    native.shellSignIn.mockRejectedValue(offline);
    const client = createFarmAuthClient();

    await expect(client.signIn({ email: "ada@example.com", password: "secret" })).rejects.toBe(
      offline,
    );
    expect(native.serverFetch).not.toHaveBeenCalled();
  });

  it("rejects social sign-in with an actionable error and calls nothing", async () => {
    const client = createFarmAuthClient();
    await expect(
      client.signIn({ provider: "github" } as unknown as Parameters<typeof client.signIn>[0]),
    ).rejects.toThrow("social and OAuth sign-in need a browser session");
    expect(native.shellSignIn).not.toHaveBeenCalled();
  });
});

describe("useAuth on native screens", () => {
  it("keeps the web hook's shape and loads the session once mounted", async () => {
    native.serverFetch.mockResolvedValue(json(SESSION));
    const client = createFarmAuthClient();

    const first = client.useAuth();
    expect(Object.keys(first).sort()).toEqual(
      [
        "error",
        "isPending",
        "isRefetching",
        "refetch",
        "session",
        "signIn",
        "signOut",
        "signUp",
        "user",
      ].sort(),
    );
    expect(first).toMatchObject({ user: null, session: null, isPending: true, error: null });

    const listener = vi.fn();
    store.subscribe!(listener);
    await flush();

    const signedIn = client.useAuth();
    expect(listener).toHaveBeenCalled();
    expect(signedIn.user?.id).toBe("u1");
    expect(signedIn.session?.id).toBe("s1");
    expect(signedIn).toMatchObject({ isPending: false, isRefetching: false, error: null });
    expect(signedIn.signOut).toBe(client.signOut);

    native.serverFetch.mockResolvedValue(json({ success: true }));
    await signedIn.signOut();
    expect(client.useAuth()).toMatchObject({ user: null, session: null, isPending: false });
  });

  it("reports a refused device token as signed out, with no error", async () => {
    native.serverFetch.mockResolvedValue(json({}, 401, "Unauthorized"));
    const client = createFarmAuthClient();
    client.useAuth();
    store.subscribe!(() => {});
    await flush();

    expect(client.useAuth()).toMatchObject({
      user: null,
      session: null,
      isPending: false,
      error: null,
    });
  });

  it("has the user once signIn resolves, as the web hook updates after a sign-in", async () => {
    native.serverFetch.mockResolvedValueOnce(json({}, 401, "Unauthorized"));
    const client = createFarmAuthClient();
    const listener = vi.fn();
    client.useAuth();
    store.subscribe!(listener);
    await flush();
    expect(client.useAuth()).toMatchObject({ user: null, isPending: false });

    native.shellSignIn.mockResolvedValue(reply(SIGNED_IN));
    native.serverFetch.mockResolvedValue(json(SESSION));
    listener.mockClear();
    await client.useAuth().signIn({ email: "ada@example.com", password: "secret" });

    // The session route, now with the device token the shell issued.
    expect(native.serverFetch).toHaveBeenLastCalledWith("/api/auth/get-session", {
      method: "GET",
    });
    expect(listener).toHaveBeenCalled();
    expect(client.useAuth()).toMatchObject({ isPending: false, error: null });
    expect(client.useAuth().user?.id).toBe("u1");
  });

  it("keeps useAuth signed out after a refused sign-in", async () => {
    native.serverFetch.mockResolvedValue(json({}, 401, "Unauthorized"));
    const client = createFarmAuthClient();
    client.useAuth();
    store.subscribe!(() => {});
    await flush();
    const calls = native.serverFetch.mock.calls.length;

    native.shellSignIn.mockResolvedValue(reply({ code: "INVALID_EMAIL_OR_PASSWORD" }, 401));
    await client.signIn({ email: "ada@example.com", password: "wrong" });

    expect(native.serverFetch.mock.calls.length).toBe(calls);
    expect(client.useAuth()).toMatchObject({ user: null, session: null, error: null });
  });

  it("passes refetch query params to the session route", async () => {
    native.serverFetch.mockResolvedValue(json(SESSION));
    const client = createFarmAuthClient();
    await client.useAuth().refetch({ query: { disableCookieCache: true } });

    expect(native.serverFetch).toHaveBeenCalledWith(
      "/api/auth/get-session?disableCookieCache=true",
      { method: "GET" },
    );
    expect(client.useAuth().user?.id).toBe("u1");
  });
});
