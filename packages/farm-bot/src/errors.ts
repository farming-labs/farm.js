export type BotErrorCode =
  | "invalid_provider"
  | "missing_site_key"
  | "missing_secret_key"
  | "test_key_in_production"
  | "invalid_secret_key"
  | "missing_request"
  | "missing_plugin";

/** A configuration problem the app owner has to fix. Visitor failures are returned, not thrown. */
export class BotError extends Error {
  override readonly name = "BotError";
  readonly code: BotErrorCode;

  constructor(code: BotErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}
