const assert = require("node:assert/strict");
const { test } = require("node:test");

const { planPromotions } = require("./promote-betas");

const tags = (table) => (name) => {
  if (!(name in table)) throw new Error("E404");
  return table[name];
};

test("promotes a published beta when latest is still a prerelease", () => {
  const plan = planPromotions(
    [{ name: "@farm.js/vue", version: "0.1.0-beta.29" }],
    tags({ "@farm.js/vue": { beta: "0.1.0-beta.29", latest: "0.1.0-beta.28" } }),
  );
  assert.deepEqual(plan.promotions, ["@farm.js/vue@0.1.0-beta.29"]);
  assert.deepEqual(plan.validationErrors, []);
});

test("accepts stable packages already published to latest", () => {
  const plan = planPromotions(
    [
      { name: "@farm.js/core", version: "0.1.0" },
      { name: "@farm.js/vue", version: "0.1.0-beta.29" },
    ],
    tags({
      "@farm.js/core": { beta: "0.1.0-beta.109", latest: "0.1.0" },
      "@farm.js/vue": { beta: "0.1.0-beta.29", latest: "0.1.0-beta.29" },
    }),
  );
  assert.deepEqual(plan.promotions, []);
  assert.deepEqual(plan.validationErrors, []);
});

test("rejects a stable package that is not on latest yet", () => {
  const plan = planPromotions(
    [{ name: "@farm.js/core", version: "0.1.0" }],
    tags({ "@farm.js/core": { beta: "0.1.0-beta.109", latest: "0.1.0-beta.109" } }),
  );
  assert.match(
    plan.validationErrors[0],
    /latest tag for @farm\.js\/core points to 0\.1\.0-beta\.109, not stable 0\.1\.0/,
  );
});

test("never moves latest off a stable release", () => {
  const plan = planPromotions(
    [{ name: "@farm.js/core", version: "0.1.1-beta.0" }],
    tags({ "@farm.js/core": { beta: "0.1.1-beta.0", latest: "0.1.0" } }),
  );
  assert.deepEqual(plan.promotions, []);
  assert.deepEqual(plan.validationErrors, []);
});

test("rejects other prerelease identifiers and unpublished betas", () => {
  const plan = planPromotions(
    [
      { name: "@farm.js/core", version: "0.1.0-canary.1" },
      { name: "@farm.js/solid", version: "0.1.0-beta.29" },
      { name: "@farm.js/new", version: "0.1.0-beta.0" },
    ],
    tags({ "@farm.js/solid": { beta: "0.1.0-beta.28", latest: "0.1.0-beta.28" } }),
  );
  assert.equal(plan.validationErrors.length, 3);
  assert.match(plan.validationErrors[0], /non-beta prerelease @farm\.js\/core@0\.1\.0-canary\.1/);
  assert.match(
    plan.validationErrors[1],
    /beta tag for @farm\.js\/solid points to 0\.1\.0-beta\.28/,
  );
  assert.match(plan.validationErrors[2], /Could not read npm dist-tags for @farm\.js\/new/);
});
