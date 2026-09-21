// @vitest-environment node

import { describe, expect, it } from "vitest";
import { stripe } from "../../../farm-stripe/src/index";
import {
  collectOwnerModels,
  findSchemaTableOwners,
  migrateSchemaTables,
  readSchemaTables,
} from "../schema-tables";

/**
 * The stripe integration declares the billing tables it owns, so an app that
 * configures it gets `farm stripe migrate` with no extra wiring.
 *
 * Its connection comes from the app's `storage.client` rather than from its own
 * options, which is the case that made the declaration hand the resolved config
 * to `resolveClient`.
 */
function billing() {
  return stripe({ instance: { fake: true } as never });
}

describe("stripe declares its billing tables", () => {
  it("declares itself under the name the command uses", () => {
    expect(readSchemaTables(billing())?.name).toBe("stripe");
  });

  it("is found by the same discovery the cli uses, as an integration", () => {
    const owners = findSchemaTableOwners({ integrations: { billing: billing() } });
    expect(owners.map((owner) => owner.name)).toEqual(["stripe"]);
  });

  it("claims the mapped table names its schema declares", () => {
    const owner = findSchemaTableOwners({ integrations: { billing: billing() } })[0]!;
    // stripeSchema sets `name` on every model, so the table is the mapped name
    // rather than the model key.
    expect(collectOwnerModels(owner).map((model) => model.modelName)).toContain("billing_account");
  });

  it("resolves nothing when the app configured no storage client", async () => {
    const owner = findSchemaTableOwners({ integrations: { billing: billing() } })[0]!;
    expect(await owner.resolveClient({})).toBeUndefined();
  });
});

describe("migrating a stripe app", () => {
  it("creates the billing tables in the database the app configured", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");
    const owner = findSchemaTableOwners({ integrations: { billing: billing() } })[0]!;

    const result = await migrateSchemaTables(owner, {
      apply: true,
      config: { storage: { client: database } },
    });

    expect(result.applied).toContain("billing_account");

    const columns = (
      database.prepare("pragma table_info('billing_account')").all() as { name: string }[]
    ).map((row) => row.name);
    // Mapped column names, not the schema keys.
    expect(columns).toContain("owner_id");
    expect(columns).not.toContain("ownerId");
  });

  it("reports it is up to date on a second run", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");
    const owner = findSchemaTableOwners({ integrations: { billing: billing() } })[0]!;
    const config = { storage: { client: database } };

    await migrateSchemaTables(owner, { apply: true, config });
    const logs: string[] = [];
    const second = await migrateSchemaTables(owner, {
      apply: true,
      config,
      log: (message) => logs.push(message),
    });

    expect(second.applied).toEqual([]);
    expect(logs.join("\n")).toContain("Already up to date");
  });
});
