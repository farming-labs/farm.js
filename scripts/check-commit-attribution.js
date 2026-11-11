/**
 * Reject pull request commits that credit a coding tool as an author or
 * co-author.
 *
 * A squash merge lists each commit's `Co-authored-by` trailers, and each
 * commit author besides the pull request's, as co-authors of the commit on
 * main. #2691's commits had no trailer but a tool author, and main got
 * `Co-authored-by: Claude`. AGENTS.md asks for no tool attribution; this check
 * keeps that from depending on every tool's local settings.
 *
 * Input is one JSON object per line on stdin, `{ sha, authorEmail, message }`,
 * built from the pull request's commit list:
 *
 *   gh api --paginate "repos/OWNER/REPO/pulls/NUMBER/commits?per_page=100" \
 *     --jq '.[] | {sha, authorEmail: .commit.author.email, message: .commit.message}' \
 *     | node scripts/check-commit-attribution.js --expected-count COMMITS
 *
 * Only addresses seen on this repository are listed. Add one when another tool
 * shows up in a trailer.
 */
const TOOL_ADDRESSES = new Set(["noreply@anthropic.com"]);

const COAUTHOR_TRAILER = /^\s*co-authored-by:.*<([^<>\s]+)>\s*$/i;

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function isToolAddress(address) {
  return typeof address === "string" && TOOL_ADDRESSES.has(address.trim().toLowerCase());
}

function findToolAttribution(commits) {
  const findings = [];
  for (const commit of commits) {
    if (isToolAddress(commit.authorEmail)) {
      findings.push({ sha: commit.sha, line: `Author: ${commit.authorEmail}` });
    }
    for (const line of String(commit.message ?? "").split(/\r?\n/)) {
      const match = COAUTHOR_TRAILER.exec(line);
      if (match && isToolAddress(match[1])) findings.push({ sha: commit.sha, line: line.trim() });
    }
  }
  return findings;
}

function parseCommits(input) {
  const commits = [];
  const lines = input.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    let commit;
    try {
      commit = JSON.parse(line);
    } catch (error) {
      throw new Error(`Line ${index + 1} of stdin is not JSON: ${line.slice(0, 80)}`, {
        cause: error,
      });
    }
    if (typeof commit?.sha !== "string" || typeof commit.message !== "string") {
      throw new Error(
        `Line ${index + 1} of stdin needs a string \`sha\` and \`message\`, like the command at the top of scripts/check-commit-attribution.js prints.`,
      );
    }
    commits.push(commit);
  }
  return commits;
}

function parseExpectedCount(argv) {
  const index = argv.indexOf("--expected-count");
  if (index === -1) return undefined;
  const value = Number(argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("`--expected-count` needs the pull request's commit count, a whole number.");
  }
  return value;
}

function main() {
  const expectedCount = parseExpectedCount(process.argv.slice(2));
  const commits = parseCommits(require("node:fs").readFileSync(0, "utf8"));

  if (expectedCount !== undefined && commits.length !== expectedCount) {
    throw new Error(
      `Read ${plural(commits.length, "commit")}, but the pull request has ${expectedCount}. GitHub lists at most 250 commits for a pull request, so split one that has more.`,
    );
  }

  const findings = findToolAttribution(commits);
  if (findings.length === 0) {
    console.log(`No tool attribution in ${plural(commits.length, "commit")}.`);
    return;
  }

  console.error(
    `Found ${plural(findings.length, "credit")} to a coding tool in this pull request's commits, which AGENTS.md rules out:`,
  );
  for (const { sha, line } of findings) console.error(`  ${sha.slice(0, 9)}  ${line}`);
  console.error(
    "Rewrite each listed commit without the `Co-authored-by` line and with yourself as author (`git commit --amend --reset-author` for the last one, `git rebase -i` for older ones), then push with `--force-with-lease`. Turn the tool's commit attribution off so new commits stay clean.",
  );
  process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { findToolAttribution, parseCommits };
