import { belongsTo, boolean, datetime, defineSchema, hasMany, id, integer, model, string } from "@farming-labs/orm";

/** At most this many `missingContext` and `docIssues` entries each are kept per submission. */
export const MAX_FEEDBACK_ISSUES = 20;

const text = (description: string, maxLength: number) => ({
  type: "string",
  maxLength,
  description,
});
const list = (description: string) => ({
  type: "array",
  items: text("One item.", 500),
  description: `${description} Only the first ${MAX_FEEDBACK_ISSUES} are kept.`,
});

/**
 * The `payload` agents send to `/api/docs?feedback=agent` and the docs MCP `submit_feedback`
 * tool: the docs engine's default fields, with length caps because the site stores what it
 * receives. The engine answers 400 for anything over a cap, before the site sees it.
 */
export const agentFeedbackPayloadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["task", "outcome"],
  properties: {
    task: text("What the agent was trying to do.", 1000),
    understanding: text('How well the docs helped, e.g. "clear" or "partial".', 200),
    outcome: text('What happened, e.g. "implemented" or "blocked".', 200),
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Confidence score from 0 to 1.",
    },
    neededCodeReading: {
      type: "boolean",
      description: "Whether the agent still needed to read the Farm.js source.",
    },
    missingContext: list("Details the docs did not give clearly enough."),
    docIssues: list("Specific problems found in the docs."),
    suggestedImprovement: text("A concrete suggestion for the page or its examples.", 2000),
  },
};

/**
 * Agent feedback about the docs, kept in the `feedback` storage mount on Farm.js Infra. One row
 * per submission, plus one row per missing piece of context or docs issue the agent listed, so
 * the pages that collect the most issues can be counted with SQL.
 */
export const feedbackSchema = defineSchema({
  agentFeedback: model({
    table: "agent_feedback",
    fields: {
      id: id(),
      page: string().nullable(),
      source: string().nullable(),
      locale: string().nullable(),
      task: string(),
      outcome: string(),
      understanding: string().nullable(),
      confidencePercent: integer().map("confidence_percent").nullable(),
      neededCodeReading: boolean().map("needed_code_reading").nullable(),
      suggestedImprovement: string().map("suggested_improvement").nullable(),
      createdAt: datetime().map("created_at").defaultNow(),
    },
    relations: {
      issues: hasMany("agentFeedbackIssue", { foreignKey: "feedbackId" }),
    },
  }),
  agentFeedbackIssue: model({
    table: "agent_feedback_issue",
    fields: {
      id: id(),
      feedbackId: string().map("feedback_id").references("agentFeedback.id"),
      kind: string(),
      text: string(),
    },
    relations: {
      feedback: belongsTo("agentFeedback", { foreignKey: "feedbackId" }),
    },
  }),
});
