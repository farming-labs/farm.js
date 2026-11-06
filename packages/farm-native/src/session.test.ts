import { describe, expect, it, vi } from "vitest";
import { fetchWithFarmSession, type FarmShellSession } from "./session";

const SERVER = "https://notes.example.com";

function shell(
  initial: string | null,
  refreshed: string | null = "fma1.next",
): FarmShellSession & {
  refreshes: string[];
} {
  let token = initial;
  const refreshes: string[] = [];
  return {
    refreshes,
    session: vi.fn(async () => ({ appId: "com.example.notes", accessToken: token })),
    refreshSession: vi.fn(async (failed: string) => {
      refreshes.push(failed);
      token = refreshed;
      return refreshed;
    }),
    signOut: vi.fn(async () => {
      token = null;
    }),
  };
}

/** A fetch that answers 401 to `rejected` tokens and records every call's headers. */
function server(rejected: Set<string> = new Set()) {
  const calls: Array<{ url: string; headers: Headers; body: unknown }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(url), headers, body: init?.body });
    const token = headers.get("authorization")?.replace(/^Bearer /, "");
    return token && rejected.has(token)
      ? new Response("expired", { status: 401 })
      : Response.json({ ok: true });
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

describe("fetchWithFarmSession", () => {
  it("sends the device's bearer token and app id to the server", async () => {
    const { calls, fetch } = server();
    const response = await fetchWithFarmSession(`${SERVER}/api/notes`, undefined, {
      server: SERVER,
      shell: shell("fma1.current"),
      fetch,
    });
    expect(response.status).toBe(200);
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer fma1.current");
    expect(calls[0]!.headers.get("x-farm-mobile")).toBe("com.example.notes");
    expect(calls[0]!.headers.get("accept")).toBe("application/json");
  });

  it("refreshes once on a 401 and retries with the new token", async () => {
    const { calls, fetch } = server(new Set(["fma1.current"]));
    const device = shell("fma1.current");
    const response = await fetchWithFarmSession(
      `${SERVER}/api/notes`,
      { method: "POST", body: JSON.stringify({ title: "a" }) },
      { server: SERVER, shell: device, fetch },
    );
    expect(response.status).toBe(200);
    expect(device.refreshes).toEqual(["fma1.current"]);
    expect(calls.map((call) => call.headers.get("authorization"))).toEqual([
      "Bearer fma1.current",
      "Bearer fma1.next",
    ]);
    expect(calls[1]!.body).toBe(JSON.stringify({ title: "a" }));
  });

  it("refreshes only once and returns the 401 when the device is signed out", async () => {
    const { calls, fetch } = server(new Set(["fma1.current", "fma1.next"]));
    const signedOut = shell("fma1.current", null);
    const response = await fetchWithFarmSession(`${SERVER}/api/notes`, undefined, {
      server: SERVER,
      shell: signedOut,
      fetch,
    });
    expect(response.status).toBe(401);
    expect(signedOut.refreshes).toHaveLength(1);
    expect(calls).toHaveLength(1);

    const stillRejected = shell("fma1.current");
    const again = await fetchWithFarmSession(`${SERVER}/api/notes`, undefined, {
      server: SERVER,
      shell: stillRejected,
      fetch,
    });
    // The retry's own 401 is final: no refresh loop.
    expect(again.status).toBe(401);
    expect(stillRejected.refreshes).toHaveLength(1);
  });

  it("does not retry a request whose body was a stream", async () => {
    const { calls, fetch } = server(new Set(["fma1.current"]));
    const device = shell("fma1.current");
    const body = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    const response = await fetchWithFarmSession(
      `${SERVER}/api/upload`,
      { method: "POST", body },
      { server: SERVER, shell: device, fetch },
    );
    expect(response.status).toBe(401);
    expect(device.refreshes).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("never sends the token to another origin", async () => {
    const { calls, fetch } = server();
    const device = shell("fma1.current");
    for (const url of [
      "https://api.other.example/data",
      "https://notes.example.com.evil.example/x",
      "http://notes.example.com/x",
    ]) {
      await fetchWithFarmSession(url, undefined, { server: SERVER, shell: device, fetch });
    }
    expect(calls.map((call) => call.headers.get("authorization"))).toEqual([null, null, null]);
    expect(calls.map((call) => call.headers.get("x-farm-mobile"))).toEqual([null, null, null]);
    expect(device.session).not.toHaveBeenCalled();
  });

  it("sends no token while signed out, and keeps the caller's own Authorization", async () => {
    const { calls, fetch } = server();
    await fetchWithFarmSession(`${SERVER}/api/public`, undefined, {
      server: SERVER,
      shell: shell(null),
      fetch,
    });
    await fetchWithFarmSession(
      `${SERVER}/api/key`,
      { headers: { authorization: "Bearer app-key" } },
      { server: SERVER, shell: shell("fma1.current"), fetch },
    );
    await fetchWithFarmSession(`${SERVER}/api/public`, undefined, {
      server: SERVER,
      shell: undefined,
      fetch,
    });
    expect(calls.map((call) => call.headers.get("authorization"))).toEqual([
      null,
      "Bearer app-key",
      null,
    ]);
    expect(calls[0]!.headers.get("x-farm-mobile")).toBe("com.example.notes");
  });
});
