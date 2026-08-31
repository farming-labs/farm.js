export type FarmRedirectStatus = 301 | 302 | 303 | 307 | 308;

export interface FarmRedirectSignal {
  url: string;
  status: FarmRedirectStatus;
}

const REDIRECT_ERROR_CODE = "FARM_REDIRECT";
const NOT_FOUND_ERROR_CODE = "FARM_NOT_FOUND";
const REDIRECT_ERROR_SYMBOL = Symbol.for("farm.navigation.redirect");
const NOT_FOUND_ERROR_SYMBOL = Symbol.for("farm.navigation.notFound");

type FarmNavigationError = Error & {
  digest: string;
  [REDIRECT_ERROR_SYMBOL]?: FarmRedirectSignal;
  [NOT_FOUND_ERROR_SYMBOL]?: true;
};

export function redirect(url: string, status: FarmRedirectStatus = 307): never {
  throw createRedirectError(url, status);
}

export function permanentRedirect(url: string): never {
  redirect(url, 308);
}

export function notFound(): never {
  const error = new Error(NOT_FOUND_ERROR_CODE) as FarmNavigationError;
  error.digest = NOT_FOUND_ERROR_CODE;
  error[NOT_FOUND_ERROR_SYMBOL] = true;
  throw error;
}

export function isFarmRedirectError(error: unknown): boolean {
  return Boolean(getFarmRedirectError(error));
}

export function getFarmRedirectError(error: unknown): FarmRedirectSignal | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as Partial<FarmNavigationError>;
  if (candidate[REDIRECT_ERROR_SYMBOL]) {
    return candidate[REDIRECT_ERROR_SYMBOL] as FarmRedirectSignal;
  }

  if (
    typeof candidate.digest === "string" &&
    candidate.digest.startsWith(`${REDIRECT_ERROR_CODE};`)
  ) {
    const [, status, ...urlParts] = candidate.digest.split(";");
    const parsedStatus = Number(status);
    if (isFarmRedirectStatus(parsedStatus)) {
      return {
        status: parsedStatus,
        url: urlParts.join(";"),
      };
    }
  }

  return null;
}

export function isFarmNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Partial<FarmNavigationError>;
  return Boolean(candidate[NOT_FOUND_ERROR_SYMBOL] || candidate.digest === NOT_FOUND_ERROR_CODE);
}

function createRedirectError(url: string, status: FarmRedirectStatus): FarmNavigationError {
  const error = new Error(`${REDIRECT_ERROR_CODE};${status};${url}`) as FarmNavigationError;
  error.digest = `${REDIRECT_ERROR_CODE};${status};${url}`;
  error[REDIRECT_ERROR_SYMBOL] = { url, status };
  return error;
}

export function isFarmRedirectStatus(status: unknown): status is FarmRedirectStatus {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
