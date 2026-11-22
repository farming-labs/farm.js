import type { DocsAgentFeedbackData } from "@farming-labs/docs";
import { getDatabase } from "@farm.js/core/storage";
import { renderSafeSql } from "@farming-labs/orm";
import { MAX_FEEDBACK_ISSUES, feedbackSchema } from "./agent-feedback-schema";
import { createRateLimiter } from "./rate-limit";

/** The storage mount in farm.config.ts that holds agent feedback. */
export const FEEDBACK_MOUNT = "feedback";

/** Context values (page path, source label, locale) longer than this are not kept. */
const MAX_CONTEXT_CHARS = 512;
/** Submissions stored per minute by one server instance, across every caller. */
const STORED_PER_MINUTE = 30;

const takeSlot = createRateLimiter({ windowMs: 60_000 });

let tables: Promise<void> | undefined;

/**
 * Creates the feedback tables once per server process. `renderSafeSql` emits
 * `create table if not exists`, so this is safe on every cold start and never alters a table.
 */
function ensureTables(): Promise<void> {
  tables ??= getDatabase(FEEDBACK_MOUNT, { raw: true })
    .then((sql) => sql.executeMultiple(renderSafeSql(feedbackSchema, { dialect: "sqlite" })))
    .catch((error: unknown) => {
      tables = undefined;
      throw error;
    });
  return tables;
}

function text(value: unknown, maxLength = Number.POSITIVE_INFINITY): string | null {
  return typeof value === "string" && value.trim() && value.length <= maxLength ? value : null;
}

function items(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim() !== "")
    .slice(0, MAX_FEEDBACK_ISSUES);
}

/**
 * Stores one agent feedback submission and its listed issues in a single transaction. The docs
 * engine has already checked `payload` against `agentFeedbackPayloadSchema`. Throws when the
 * instance's budget is spent or the database is unreachable, so the caller gets an error rather
 * than a success for feedback that was not kept.
 */
export async function saveAgentFeedback({ context, payload }: DocsAgentFeedbackData) {
  if (!takeSlot("store", STORED_PER_MINUTE))
    throw new Error("Agent feedback is busy. Retry in a minute.");
  const task = text(payload.task);
  const outcome = text(payload.outcome);
  if (!task || !outcome) throw new TypeError("Send `payload.task` and `payload.outcome`.");

  await ensureTables();
  const db = await getDatabase(FEEDBACK_MOUNT);
  const confidence = payload.confidence;
  return db.transaction(async (tx) => {
    const feedback = await tx.agentFeedback.create({
      data: {
        page: text(context?.page, MAX_CONTEXT_CHARS),
        source: text(context?.source, MAX_CONTEXT_CHARS),
        locale: text(context?.locale, MAX_CONTEXT_CHARS),
        task,
        outcome,
        understanding: text(payload.understanding),
        confidencePercent: typeof confidence === "number" ? Math.round(confidence * 100) : null,
        neededCodeReading:
          typeof payload.neededCodeReading === "boolean" ? payload.neededCodeReading : null,
        suggestedImprovement: text(payload.suggestedImprovement),
      },
      select: { id: true },
    });
    const issues = [
      ...items(payload.missingContext).map((entry) => ({ kind: "missing-context", text: entry })),
      ...items(payload.docIssues).map((entry) => ({ kind: "doc-issue", text: entry })),
    ];
    if (issues.length > 0)
      await tx.agentFeedbackIssue.createMany({
        data: issues.map((issue) => ({ ...issue, feedbackId: feedback.id })),
      });
    return { id: feedback.id, issues: issues.length };
  });
}
