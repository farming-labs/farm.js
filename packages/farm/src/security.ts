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

export function resolveFarmSecurityConfig(
  input: FarmSecurityConfig | ResolvedFarmSecurityConfig | undefined,
): ResolvedFarmSecurityConfig {
  if (input === undefined) return { csp: false };
  if (!isPlainRecord(input)) {
    throw new TypeError("security must be an object containing the csp option.");
  }
  if (Object.prototype.hasOwnProperty.call(input, "contentSecurityPolicy")) {
    throw new TypeError(
      "security.contentSecurityPolicy is not supported. Use security.csp instead.",
    );
  }

  const csp = input.csp;
  if (csp === undefined || csp === false) return { csp: false };

  if (typeof csp === "string") {
    return {
      csp: {
        value: validateSerializedCsp(csp),
        reportOnly: false,
      },
    };
  }

  if (!isPlainRecord(csp)) {
    throw new TypeError("security.csp must be a policy string, false, or an options object.");
  }

  const reportOnly = validateReportOnly(csp.reportOnly);
  if (Object.prototype.hasOwnProperty.call(csp, "value")) {
    if (
      Object.prototype.hasOwnProperty.call(csp, "policy") ||
      Object.prototype.hasOwnProperty.call(csp, "directives")
    ) {
      throw new TypeError(
        "Resolved security.csp values cannot include policy or directives options.",
      );
    }
    return {
      csp: {
        value: validateSerializedCsp(csp.value),
        reportOnly,
      },
    };
  }

  const { policy, directives } = csp;
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
          : serializeFarmCspDirectives(directives as FarmCspDirectives),
      reportOnly,
    },
  };
}

export function serializeFarmCspDirectives(directives: FarmCspDirectives): string {
  if (!isPlainRecord(directives)) {
    throw new TypeError("security.csp.directives must be an object.");
  }
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

function validateSerializedCsp(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("security.csp policy must be a non-empty single-line string.");
  }
  const normalized = value.trim().replace(/;+$/g, "").trim();
  if (!normalized || /[\r\n]/.test(normalized) || normalized.includes("\0")) {
    throw new TypeError("security.csp policy must be a non-empty single-line string.");
  }
  return normalized;
}

function validateReportOnly(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new TypeError("security.csp.reportOnly must be a boolean.");
  }
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
