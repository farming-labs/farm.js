import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { escapeDoubleQuoted, escapeSqlString } = require("../dist/index.js");

test("double-quoted escaping leaves single quotes alone", () => {
  assert.equal(escapeDoubleQuoted("it's"), "it's");
  assert.equal(escapeDoubleQuoted('say "hi"'), 'say \\"hi\\"');
  assert.equal(escapeDoubleQuoted("back\\slash"), "back\\\\slash");
});

test("sql escaping doubles single quotes and keeps everything else literal", () => {
  assert.equal(escapeSqlString("it's"), "it''s");
  assert.equal(escapeSqlString('say "hi"'), 'say "hi"');
  assert.equal(escapeSqlString("back\\slash"), "back\\slash");
});
