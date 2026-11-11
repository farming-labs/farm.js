const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { test } = require("node:test");

const { findToolAttribution, parseCommits } = require("./check-commit-attribution.js");

const script = path.join(__dirname, "check-commit-attribution.js");

function run(commits, args = []) {
  const input = commits.map((commit) => JSON.stringify(commit)).join("\n");
  return spawnSync(process.execPath, [script, ...args], { input, encoding: "utf8" });
}

const human = { sha: "a".repeat(40), authorEmail: "dev@example.com", message: "fix(core): x" };

test("flags a tool co-author trailer in any casing", () => {
  const commits = [
    {
      ...human,
      message: "fix(core): x\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
    },
    {
      ...human,
      sha: "b".repeat(40),
      message: "docs: y\n\nco-authored-by: Claude <NoReply@Anthropic.com>\n",
    },
  ];

  assert.deepEqual(findToolAttribution(commits), [
    { sha: "a".repeat(40), line: "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" },
    { sha: "b".repeat(40), line: "co-authored-by: Claude <NoReply@Anthropic.com>" },
  ]);
});

test("flags a commit a tool authored", () => {
  assert.deepEqual(findToolAttribution([{ ...human, authorEmail: "noreply@anthropic.com" }]), [
    { sha: human.sha, line: "Author: noreply@anthropic.com" },
  ]);
});

test("keeps human co-authors and prose that only mentions the address", () => {
  const commits = [
    { ...human, message: "feat: z\n\nCo-authored-by: Claude Dupont <claude@example.com>" },
    { ...human, message: "ci: explain why noreply@anthropic.com trailers are rejected" },
  ];

  assert.deepEqual(findToolAttribution(commits), []);
});

test("passes clean commits and reports how many it read", () => {
  const result = run([human, { ...human, sha: "c".repeat(40) }], ["--expected-count", "2"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No tool attribution in 2 commits/);
});

test("fails with the short sha, the trailer and the fix", () => {
  const result = run([
    human,
    {
      ...human,
      sha: "d".repeat(40),
      message: "x\n\nCo-authored-by: Claude <noreply@anthropic.com>",
    },
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /d{9} {2}Co-authored-by: Claude <noreply@anthropic\.com>/);
  assert.match(result.stderr, /--force-with-lease/);
});

test("fails when it read fewer commits than the pull request has", () => {
  const result = run([human], ["--expected-count", "3"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Read 1 commit, but the pull request has 3/);
});

test("fails on empty input when a count is expected", () => {
  const result = run([], ["--expected-count", "1"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Read 0 commits/);
});

test("rejects input that is not one commit object per line", () => {
  assert.throws(() => parseCommits("not json\n"), /Line 1 of stdin is not JSON/);
  assert.throws(() => parseCommits('{"sha":"x"}\n'), /needs a string `sha` and `message`/);
  assert.equal(run([], ["--expected-count", "zero"]).status, 1);
});
