/**
 * An error a jobs runtime throws to answer a job route with a specific status.
 * `data` is returned to the caller as `details`, so keep secrets out of it.
 */
export class JobsRuntimeError extends Error {
  readonly status: number;
  readonly data?: unknown;

  constructor(message: string, status = 500, data?: unknown) {
    super(message);
    this.name = "JobsRuntimeError";
    this.status = status;
    this.data = data;
  }
}
