import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { createNodePreviewGatewayHandler } from "../../packages/farm-preview-gateway/dist/index.js";
import {
  createPersistentPreviewRelay,
  startTypeScriptPreviewAgent,
} from "../../packages/farm-preview-tunnel/dist/index.js";

test.use({
  launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : undefined,
});

for (const transport of ["websocket", "polling"] as const) {
  test(`${transport} preview hydrates islands and navigates on its own origin`, async ({
    page,
    baseURL,
  }) => {
    const token = "local-browser-fixture-only";
    const relay = createPersistentPreviewRelay({
      publicDomain: "localhost",
      registrationToken: token,
    });
    let publicUrl = "";
    const gateway = createServer(
      createNodePreviewGatewayHandler({
        domain: "localhost",
        observer: {
          session(event) {
            if (event.state === "connected") publicUrl = event.publicUrl;
          },
        },
      }),
    );
    let agent: Awaited<ReturnType<typeof startTypeScriptPreviewAgent>> | undefined;
    let cli: ChildProcess | undefined;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      if (transport === "websocket") {
        const address = await relay.listen();
        agent = await startTypeScriptPreviewAgent({
          relayUrl: address.websocketUrl,
          token,
          name: "browser-example",
          targetUrl: baseURL!,
        });
        publicUrl = agent.publicUrl;
      } else {
        await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
        const { port } = gateway.address() as { port: number };
        const target = new URL(baseURL!);
        const plan = {
          provider: "farm-gateway",
          gatewayUrl: `http://127.0.0.1:${port}`,
          requestedName: "browser-example",
          target: {
            localUrl: baseURL,
            host: target.hostname,
            port: Number(target.port),
            source: "port",
          },
        };
        cli = spawn(
          process.execPath,
          [
            "-e",
            "require(process.argv[1]).runPreviewGateway(JSON.parse(process.argv[2])).catch(() => process.exit(1))",
            resolve("packages/farm-cli/dist/index.js"),
            JSON.stringify(plan),
          ],
          { stdio: "ignore" },
        );
        await expect.poll(() => publicUrl).not.toBe("");
      }
      expect(new URL(publicUrl).hostname).toBe("browser-example.localhost");
      expect(new URL(publicUrl).port).not.toBe("");
      await page.goto(publicUrl);
      await expect(page.getByRole("heading", { name: "Isolated hydration demo" })).toBeVisible();
      await page.getByRole("button", { name: "count: 0", exact: true }).click();
      await expect(page.getByRole("button", { name: "count: 1", exact: true })).toBeVisible();
      await page.getByRole("link", { name: "about", exact: true }).click();
      await expect(page.getByRole("heading", { name: "About", exact: true })).toBeVisible();
      expect(new URL(page.url()).origin).toBe(publicUrl);
      await page.getByRole("link", { name: "home", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Isolated hydration demo" })).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      if (cli && cli.exitCode === null && cli.signalCode === null) {
        const stopped = once(cli, "exit");
        cli.kill("SIGTERM");
        const timeout = setTimeout(() => cli?.kill("SIGKILL"), 5000);
        try {
          await stopped;
        } finally {
          clearTimeout(timeout);
        }
      }
      await agent?.close();
      await relay.close();
      if (gateway.listening)
        await new Promise<void>((resolve, reject) =>
          gateway.close((error) => (error ? reject(error) : resolve())),
        );
    }
  });
}
