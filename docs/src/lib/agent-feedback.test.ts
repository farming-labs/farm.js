// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateDocsAgentFeedbackPayload } from "@farming-labs/docs";
import { MAX_FEEDBACK_ISSUES, agentFeedbackPayloadSchema } from "./agent-feedback-schema";

const db = vi.hoisted(() => {
  const state = {
    feedback: [] as Record<string, unknown>[],
    issues: [] as Record<string, unknown>[],
    migrations: [] as string[],
    failIssues: false,
  };
  return state;
});

vi.mock("@farm.js/core/storage", () => ({
  getDatabase: async (name: string, options: { raw?: boolean } = {}) => {
    if (name !== "feedback") throw new Error(`unexpected mount ${name}`);
    if (options.raw) return { executeMultiple: async (sql: string) => db.migrations.push(sql) };
    return {
      // Mirrors a real transaction: nothing lands unless the callback finishes.
      async transaction<T>(run: (tx: unknown) => Promise<T>) {
        const feedback: Record<string, unknown>[] = [];
        const issues: Record<string, unknown>[] = [];
        const value = await run({
          agentFeedback: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
              const row = { id: `fb_${db.feedback.length + feedback.length + 1}`, ...data };
              feedback.push(row);
              return { id: row.id };
            },
          },
          agentFeedbackIssue: {
            createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
              if (db.failIssues) throw new Error("SQLITE_FULL");
              issues.push(...data);
              return data;
            },
          },
        });
        db.feedback.push(...feedback);
        db.issues.push(...issues);
        return value;
      },
    };
  },
}));

const { saveAgentFeedback } = await import("./agent-feedback");

beforeEach(() => {
  db.feedback.length = 0;
  db.issues.length = 0;
  db.failIssues = false;
});

describe("saveAgentFeedback", () => {
  it("stores a submission and one row per listed issue", async () => {
    const result = await saveAgentFeedback({
      context: { page: "/docs/storage", source: "mcp", locale: "en" },
      payload: {
        task: "Add a hosted KV mount",
        outcome: "implemented",
        understanding: "clear",
        confidence: 0.857,
        neededCodeReading: false,
        missingContext: ["Which key permission `farm storage apply` needs"],
        docIssues: ["The KV example omits the import"],
        suggestedImprovement: "Show the import.",
      },
    });

    expect(result).toEqual({ id: "fb_1", issues: 2 });
    expect(db.feedback).toEqual([
      {
        id: "fb_1",
        page: "/docs/storage",
        source: "mcp",
        locale: "en",
        task: "Add a hosted KV mount",
        outcome: "implemented",
        understanding: "clear",
        confidencePercent: 86,
        neededCodeReading: false,
        suggestedImprovement: "Show the import.",
      },
    ]);
    expect(db.issues).toEqual([
      {
        feedbackId: "fb_1",
        kind: "missing-context",
        text: "Which key permission `farm storage apply` needs",
      },
      { feedbackId: "fb_1", kind: "doc-issue", text: "The KV example omits the import" },
    ]);
    expect(db.migrations.join("\n")).toMatch(/create table if not exists .?agent_feedback_issue/i);
  });

  it("keeps optional fields empty and caps the issue list", async () => {
    await saveAgentFeedback({
      context: { page: `/${"x".repeat(600)}` },
      payload: {
        task: "Read the docs",
        outcome: "blocked",
        docIssues: Array.from({ length: MAX_FEEDBACK_ISSUES + 5 }, (_, index) => `issue ${index}`),
      },
    });

    expect(db.feedback[0]).toMatchObject({
      page: null,
      source: null,
      confidencePercent: null,
      neededCodeReading: null,
    });
    expect(db.issues).toHaveLength(MAX_FEEDBACK_ISSUES);
  });

  it("stores nothing when a write fails", async () => {
    db.failIssues = true;

    await expect(
      saveAgentFeedback({ payload: { task: "t", outcome: "o", docIssues: ["broken"] } }),
    ).rejects.toThrow("SQLITE_FULL");
    expect(db.feedback).toEqual([]);
  });
});

describe("agentFeedbackPayloadSchema", () => {
  it("refuses fields over their length cap before anything is stored", () => {
    expect(
      validateDocsAgentFeedbackPayload(
        { task: "x".repeat(1001), outcome: "blocked" },
        agentFeedbackPayloadSchema,
      ),
    ).toBe("payload.task must be at most 1000 characters");
    expect(
      validateDocsAgentFeedbackPayload({ task: "t", outcome: "o" }, agentFeedbackPayloadSchema),
    ).toBeUndefined();
  });
});
