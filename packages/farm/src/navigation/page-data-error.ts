import { isFarmNotFoundError } from "../navigation-errors";

export interface FarmPageDataFailure {
  status: number;
  payload: {
    error: string;
    message: string;
    code?: string;
  };
}

/**
 * Preserve expected route outcomes when a page-data render fails. Internal
 * navigation must report the same HTTP class as a full document render so a
 * missing resource never masquerades as a framework crash.
 */
export function resolveFarmPageDataFailure(error: unknown): FarmPageDataFailure {
  if (isFarmNotFoundError(error)) {
    return {
      status: 404,
      payload: {
        error: "Route not found",
        message: "The requested route did not resolve to a resource.",
        code: "FARM_NOT_FOUND",
      },
    };
  }

  if (error instanceof Response) {
    return {
      status: error.status || 500,
      payload: {
        error: error.statusText || "Page data request failed",
        message: error.statusText || `The route returned HTTP ${error.status || 500}.`,
      },
    };
  }

  return {
    status: 500,
    payload: {
      error: "Failed to load page data",
      message: error instanceof Error ? error.message : "Unknown error",
    },
  };
}
