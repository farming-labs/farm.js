// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { generateFarmClientPluginEntryCode } from "../client-plugin-build";
import { runFarmNavigationDelegates } from "../client/navigation-delegate";
import { farmMobileShellClient } from "../mobile/client";
import { definePlugin } from "../plugin";

const previousPlatform = process.env.FARM_PLATFORM;
const host = globalThis as { __farmBridge?: unknown };

afterEach(() => {
  if (previousPlatform === undefined) delete process.env.FARM_PLATFORM;
  else process.env.FARM_PLATFORM = previousPlatform;
  delete host.__farmBridge;
});

const plugins = [definePlugin({ name: "analytics", client: { setup() {} } })];

describe("the --mobile client entry", () => {
  it("registers the shell client first in mobile builds only", () => {
    delete process.env.FARM_PLATFORM;
    const web = generateFarmClientPluginEntryCode(plugins);
    expect(web.imports).toBe("");
    expect(web.registrations).not.toContain("farm:mobile-shell");

    process.env.FARM_PLATFORM = "desktop";
    expect(generateFarmClientPluginEntryCode(plugins)).toEqual(web);

    process.env.FARM_PLATFORM = "mobile";
    const mobile = generateFarmClientPluginEntryCode(plugins);
    expect(mobile.imports).toBe(
      'import { farmMobileShellClient as __farmMobileShellClient } from "@farm.js/core/internal/client-runtime";',
    );
    expect(mobile.registrations.indexOf('name: "farm:mobile-shell"')).toBeLessThan(
      mobile.registrations.indexOf('name: "analytics"'),
    );
    expect(mobile.registrations).toContain("definition: __farmMobileShellClient");
    // The app's own plugins are unchanged.
    expect(mobile.plugins).toEqual(web.plugins);
  });
});

describe("farmMobileShellClient", () => {
  const navigation = {
    url: "http://10.0.2.2:3000/notes/1",
    from: "/notes",
    to: "/notes/1",
    action: "push" as const,
  };

  it("does nothing in a browser, where there is no shell bridge", async () => {
    const state = await farmMobileShellClient.setup?.({} as never);
    expect(state).toBeUndefined();
    expect(await runFarmNavigationDelegates(navigation)).toBe(false);
  });

  it("hands navigations to the bridge while it is set up", async () => {
    const offered: unknown[] = [];
    let take = true;
    host.__farmBridge = {
      offerNavigation(context: unknown) {
        offered.push(context);
        return take;
      },
    };
    const state = await farmMobileShellClient.setup?.({} as never);
    expect(typeof state).toBe("function");
    expect(await runFarmNavigationDelegates(navigation)).toBe(true);
    take = false;
    expect(await runFarmNavigationDelegates(navigation)).toBe(false);
    expect(offered).toEqual([navigation, navigation]);

    await farmMobileShellClient.close?.({ state, reason: "hmr" } as never);
    take = true;
    expect(await runFarmNavigationDelegates(navigation)).toBe(false);
    expect(offered).toHaveLength(2);
  });
});
