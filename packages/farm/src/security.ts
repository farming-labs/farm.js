export type FarmCspDirectiveValue = string | readonly string[] | boolean | null | undefined;

export type FarmCspDirectives = Readonly<Record<string, FarmCspDirectiveValue>>;

export interface FarmCspOptions {
  /** A pre-serialized CSP value. Cannot be combined with directives. */
  policy?: string;
  /** CSP directives using camelCase or kebab-case names. */
  directives?: FarmCspDirectives;
  /** Emit Content-Security-Policy-Report-Only instead of enforcing the policy. */
  reportOnly?: boolean;
}

export type FarmCspConfig = string | FarmCspOptions;

export interface FarmSecurityConfig {
  /** App-wide Content Security Policy applied to pages, APIs, and static output. */
  csp?: FarmCspConfig | false;
  /** @deprecated Use csp. */
  contentSecurityPolicy?: never;
}

export interface ResolvedFarmCspConfig {
  value: string;
  reportOnly: boolean;
}

export interface ResolvedFarmSecurityConfig {
  csp: ResolvedFarmCspConfig | false;
}

export function isResolvedFarmSecurityConfig(
  input: FarmSecurityConfig | ResolvedFarmSecurityConfig | undefined,
): input is ResolvedFarmSecurityConfig {
  return Boolean(
    input &&
    (input.csp === false ||
      (typeof input.csp === "object" &&
        input.csp !== null &&
        "value" in input.csp &&
        "reportOnly" in input.csp)),
  );
}

export function resolveFarmSecurityConfig(
  input: FarmSecurityConfig | undefined,
): ResolvedFarmSecurityConfig {
  if (input && Object.prototype.hasOwnProperty.call(input, "contentSecurityPolicy")) {
    throw new TypeError(
      "security.contentSecurityPolicy is not supported. Use security.csp instead.",
    );
  }

  if (input?.csp === undefined || input.csp === false) return { csp: false };

  if (typeof input.csp === "string") {
    return {
      csp: {
        value: validateSerializedCsp(input.csp),
        reportOnly: false,
      },
    };
  }

  const { policy, directives, reportOnly = false } = input.csp;
  if (policy !== undefined && directives !== undefined) {
    throw new TypeError("security.csp accepts either policy or directives, not both.");
  }
  if (policy === undefined && directives === undefined) {
    throw new TypeError("security.csp requires a policy string or directives object.");
  }

  return {
    csp: {
      value:
        policy !== undefined
          ? validateSerializedCsp(policy)
          : serializeFarmCspDirectives(directives!),
      reportOnly,
    },
  };
}

export function serializeFarmCspDirectives(directives: FarmCspDirectives): string {
  const serialized: string[] = [];
  const normalizedNames = new Set<string>();

  for (const [configuredName, configuredValue] of Object.entries(directives)) {
    if (configuredValue === false || configuredValue === null || configuredValue === undefined) {
      continue;
    }

    const name = normalizeDirectiveName(configuredName);
    if (normalizedNames.has(name)) {
      throw new TypeError(`security.csp contains the duplicate directive ${JSON.stringify(name)}.`);
    }
    normalizedNames.add(name);

    const values =
      configuredValue === true
        ? []
        : (Array.isArray(configuredValue) ? configuredValue : [configuredValue]).map(
            validateDirectiveValue,
          );
    serialized.push(values.length > 0 ? `${name} ${values.join(" ")}` : name);
  }

  if (serialized.length === 0) {
    throw new TypeError("security.csp.directives must contain at least one enabled directive.");
  }
  return serialized.join("; ");
}

export function getFarmSecurityHeader(
  security: ResolvedFarmSecurityConfig,
): { key: string; value: string } | undefined {
  if (!security.csp) return undefined;
  return {
    key: security.csp.reportOnly
      ? "Content-Security-Policy-Report-Only"
      : "Content-Security-Policy",
    value: security.csp.value,
  };
}

function normalizeDirectiveName(value: string): string {
  const name = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new TypeError(`Invalid security.csp directive name: ${JSON.stringify(value)}.`);
  }
  return name;
}

function validateDirectiveValue(value: string): string {
  if (typeof value !== "string") {
    throw new TypeError("security.csp directive values must be strings or booleans.");
  }
  const normalized = value.trim();
  if (!normalized || /[;\r\n]/.test(normalized) || normalized.includes("\0")) {
    throw new TypeError(`Invalid security.csp directive value: ${JSON.stringify(value)}.`);
  }
  return normalized;
}

function validateSerializedCsp(value: string): string {
  const normalized = value.trim().replace(/;+$/g, "").trim();
  if (!normalized || /[\r\n]/.test(normalized) || normalized.includes("\0")) {
    throw new TypeError("security.csp policy must be a non-empty single-line string.");
  }
  return normalized;
}
