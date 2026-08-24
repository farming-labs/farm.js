export interface ResolveCallbackSettingsInput {
  callbackUrl?: string;
  callbackPath?: string;
  defaultPath: string;
  label: string;
}

export function getOrigin(request: Request, configuredBaseUrl?: string): string {
  return configuredBaseUrl || new URL(request.url).origin;
}

export function getReturnTo(rawValue: string | null | undefined, fallback = "/"): string {
  // Must be a same-origin, root-relative path. A bare startsWith("/") check is
  // not enough: "//evil.com" (protocol-relative) and "/\evil.com" (browsers
  // and the URL parser treat "\" as "/") both begin with "/" yet resolve to a
  // foreign origin when passed to `new URL(returnTo, origin)`, giving an open
  // redirect after a legitimate login.
  if (!rawValue || !rawValue.startsWith("/")) {
    return fallback;
  }

  const second = rawValue[1];
  if (second === "/" || second === "\\") {
    return fallback;
  }

  return rawValue;
}

export function toAbsoluteUrl(
  pathOrUrl: string,
  request: Request,
  configuredBaseUrl?: string,
): URL {
  try {
    return new URL(pathOrUrl);
  } catch {
    return new URL(pathOrUrl, getOrigin(request, configuredBaseUrl));
  }
}

export function withSearchParams(url: URL, params: Record<string, string | null | undefined>): URL {
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") {
      continue;
    }

    url.searchParams.set(key, value);
  }

  return url;
}

export function resolveAppPath(path: string | undefined, label: string): string | undefined {
  if (!path) {
    return undefined;
  }

  if (!path.startsWith("/")) {
    throw new Error(`${label} must be a root-relative path.`);
  }

  return path;
}

export function resolveCallbackSettings(
  input: ResolveCallbackSettingsInput,
  configuredBaseUrl?: string,
): {
  callbackPath: string;
  getCallbackUrl: (request: Request, params?: Record<string, string | null | undefined>) => string;
} {
  if (input.callbackUrl) {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(input.callbackUrl);
    } catch {
      throw new Error(`${input.label} callbackUrl must be an absolute URL.`);
    }

    if (input.callbackPath && input.callbackPath !== parsedUrl.pathname) {
      throw new Error(
        `${input.label} callbackUrl pathname must match callbackPath when both are provided.`,
      );
    }

    return {
      callbackPath: input.callbackPath ?? parsedUrl.pathname,
      getCallbackUrl(_request: Request, params = {}) {
        return withSearchParams(new URL(parsedUrl.toString()), params).toString();
      },
    };
  }

  const callbackPath = input.callbackPath ?? input.defaultPath;
  return {
    callbackPath,
    getCallbackUrl(request: Request, params = {}) {
      return withSearchParams(
        new URL(callbackPath, getOrigin(request, configuredBaseUrl)),
        params,
      ).toString();
    },
  };
}
