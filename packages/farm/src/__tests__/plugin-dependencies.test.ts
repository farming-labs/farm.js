// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../config";
import { defineIntegration } from "../integrations";
import { definePlugin } from "../plugin";
import { defineSchema } from "../schema";
import { checkSchema, formatSchemaCheck } from "../schema-check";
import { collectSchemaDependencies, orderSchemaOwners } from "../schema-dependencies";
import { findSchemaTableOwners } from "../schema-tables";

const teamsSchema = defineSchema({
  models: {
    organization: { fields: { id: { type: "uuid", primaryKey: true } } },
  },
});

const billingSchema = defineSchema({
  models: {
    subscription: {
      fields: {
        id: { type: "uuid", primaryKey: true },
        organizationId: {
          type: "uuid",
          reference: { model: "organization", field: "id", enforced: "app" },
        },
      },
    },
  },
});

const teams = () => definePlugin({ name: "farm:teams", schema: teamsSchema });
const billing = (dependsOn?: string[]) =>
  definePlugin({ name: "farm:billing", schema: billingSchema, dependsOn });

describe("dependsOn while the config loads", () => {
  it("accepts a dependency by full name, short name, or integration key", async () => {
    await expect(
      resolveConfig({ plugins: [teams(), billing(["farm:teams"])] }, "production"),
    ).resolves.toBeTruthy();
    await expect(
      resolveConfig({ plugins: [billing(["teams"]), teams()] }, "production"),
    ).resolves.toBeTruthy();
    const stripe = defineIntegration({ category: "payment", type: "custom", instance: {} });
    await expect(
      resolveConfig(
        {
          integrations: { stripe } as never,
          plugins: [definePlugin({ name: "acme:invoices", dependsOn: ["stripe"] })],
        },
        "production",
      ),
    ).resolves.toBeTruthy();
  });

  it("fails, naming what is configured, when a dependency is missing", async () => {
    await expect(
      resolveConfig(
        { plugins: [definePlugin({ name: "acme:other" }), billing(["teams"])] },
        "production",
      ),
    ).rejects.toThrow(
      'Plugin "farm:billing" depends on "teams", which is not configured. Add it to `plugins` (or `integrations`) in farm.config. Configured: acme:other.',
    );
  });

  it("fails for a plugin that names itself", async () => {
    await expect(resolveConfig({ plugins: [billing(["billing"])] }, "production")).rejects.toThrow(
      'Plugin "farm:billing" lists itself in `dependsOn`.',
    );
  });

  it("fails for a cycle, and names it", async () => {
    const a = definePlugin({ name: "acme:a", dependsOn: ["b"] });
    const b = definePlugin({ name: "acme:b", dependsOn: ["c"] });
    const c = definePlugin({ name: "acme:c", dependsOn: ["a"] });
    await expect(resolveConfig({ plugins: [a, b, c] }, "production")).rejects.toThrow(
      "Plugins depend on each other in a cycle: a → b → c → a.",
    );
  });

  it("rejects a dependsOn that is not a list of names", async () => {
    const broken = definePlugin({ name: "acme:a", dependsOn: "b" as never });
    await expect(resolveConfig({ plugins: [broken] }, "production")).rejects.toThrow(
      /invalid `dependsOn`/,
    );
  });
});

describe("dependencies between table owners", () => {
  it("are implied by a reference to a table another plugin creates", () => {
    const owners = findSchemaTableOwners({ plugins: [billing(), teams()] });
    expect(collectSchemaDependencies(owners)).toEqual(
      new Map([
        ["billing", new Set(["teams"])],
        ["teams", new Set()],
      ]),
    );
    expect(orderSchemaOwners(owners).map((owner) => owner.name)).toEqual(["teams", "billing"]);
  });

  it("are implied by columns added to another plugin's table", () => {
    const seats = definePlugin({
      name: "farm:seats",
      schema: defineSchema({
        models: {
          organization: { external: true, fields: { id: { type: "uuid", primaryKey: true } } },
        },
        extend: { organization: { fields: { seats: { type: "integer", default: 1 } } } },
      }),
    });
    const owners = findSchemaTableOwners({ plugins: [seats, teams()] });
    expect(orderSchemaOwners(owners).map((owner) => owner.name)).toEqual(["teams", "seats"]);
  });

  it("include what a plugin declares, even with no reference", () => {
    const audit = definePlugin({
      name: "farm:audit",
      schema: defineSchema({
        models: { event: { fields: { id: { type: "uuid", primaryKey: true } } } },
      }),
      dependsOn: ["teams"],
    });
    const owners = findSchemaTableOwners({ plugins: [audit, teams()] });
    expect(orderSchemaOwners(owners).map((owner) => owner.name)).toEqual(["teams", "audit"]);
  });

  it("ignore tables nobody in the app creates", () => {
    const owners = findSchemaTableOwners({ plugins: [billing()] });
    expect(collectSchemaDependencies(owners).get("billing")).toEqual(new Set());
  });

  it("list each owner once when two only refer to each other", () => {
    const left = definePlugin({
      name: "farm:left",
      schema: defineSchema({
        models: {
          leftRow: {
            fields: {
              id: { type: "uuid", primaryKey: true },
              rightId: {
                type: "uuid",
                reference: { model: "rightRow", field: "id", enforced: "app" },
              },
            },
          },
        },
      }),
    });
    const right = definePlugin({
      name: "farm:right",
      schema: defineSchema({
        models: {
          rightRow: {
            fields: {
              id: { type: "uuid", primaryKey: true },
              leftId: {
                type: "uuid",
                reference: { model: "leftRow", field: "id", enforced: "app" },
              },
            },
          },
        },
      }),
    });
    const owners = findSchemaTableOwners({ plugins: [left, right] });
    expect(orderSchemaOwners(owners).map((owner) => owner.name)).toEqual(["right", "left"]);
    expect(orderSchemaOwners([...owners].reverse()).map((owner) => owner.name)).toEqual([
      "left",
      "right",
    ]);
  });
});

describe("farm schema check", () => {
  it("lists dependencies first and says what each owner needs", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");
    const report = await checkSchema({
      plugins: [billing(), teams()],
      storage: { client: database },
    });
    expect(report.owners.map((owner) => [owner.name, owner.dependsOn])).toEqual([
      ["teams", []],
      ["billing", ["teams"]],
    ]);
    expect(formatSchemaCheck(report)).toContain("✗ billing (plugin, sqlite, needs teams)");
    database.close();
  });
});
