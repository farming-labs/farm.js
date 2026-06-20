"use client";

import { useEffect, useState } from "react";
import type {
  StripeBillingCheckResult,
  StripeBillingFeaturesResult,
  StripeBillingLimitsResult,
  StripeBillingMeterUsageResult,
  StripeBillingUpcomingInvoiceLineResult,
  StripeBillingUpcomingInvoiceResult,
  StripeBillingReportUsageResult,
  StripeBillingStatusResult,
  StripeCatalogProduct,
  StripeBillingUsageResult,
} from "@farmjs/integrations/stripe/client";
import { apiClient } from "../../lib/api";
import {
  authOrganizationClient,
  type ActiveOrganizationRecord,
  type AuthOrganizationInvitation,
  type AuthOrganizationRecord,
} from "../../lib/auth-organization-client";
import { authClient } from "../../lib/auth-client";

type SessionState =
  | { status: "loading" }
  | { status: "unauthorized" }
  | {
      status: "ready";
      user: {
        email: string;
        name: string;
      };
    };

type UsageMap = Record<string, StripeBillingUsageResult | null>;
type CheckMap = Record<string, StripeBillingCheckResult | null>;
type MeterUsageMap = Record<string, StripeBillingMeterUsageResult | null>;
type PendingMeterProjection = {
  projectedCurrentPeriodUsed: number;
  pendingUntil: number;
  state: string | null;
  warning: string | null;
};
type PendingMeterProjectionMap = Record<string, PendingMeterProjection | null>;
type ThemeMode = "light" | "dark";

const monthlyPlanHighlights = {
  free: ["4 seats", "1 project", "100k included tokens"],
  pro: ["5 included seats", "10 projects", "1M included tokens"],
  business: ["25 included seats", "Unlimited projects", "10M included tokens"],
} as const;

function formatAmount(unitAmount: number | null | undefined) {
  if (typeof unitAmount !== "number") {
    return "Custom";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: unitAmount % 100 === 0 ? 0 : 2,
  }).format(unitAmount / 100);
}

function formatMoney(unitAmount: number | null | undefined, currency = "usd") {
  if (typeof unitAmount !== "number") {
    return "Custom";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: unitAmount % 100 === 0 ? 0 : 2,
  }).format(unitAmount / 100);
}

function formatPlanName(planId: string) {
  return planId.charAt(0).toUpperCase() + planId.slice(1);
}

function formatSeatMode(mode: string | null | undefined) {
  switch (mode) {
    case "subscription_quantity":
      return "Subscription quantity";
    case "plan_limit":
      return "Plan limit";
    default:
      return "Not configured";
  }
}

function formatSeatLimitSource(source: string | null | undefined) {
  switch (source) {
    case "override":
      return "Manual override";
    case "subscription_quantity":
      return "Subscription quantity";
    case "plan_limit":
      return "Plan limit";
    default:
      return "Not configured";
  }
}

function formatLimit(limit: number | null | undefined) {
  if (typeof limit !== "number") {
    return "Not configured";
  }

  if (limit < 0) {
    return "Unlimited";
  }

  return String(limit);
}

function formatUsageValue(value: number | null | undefined) {
  return typeof value === "number" ? String(value) : "Unavailable";
}

function formatWholeNumber(value: number | null | undefined) {
  return typeof value === "number" ? value.toLocaleString() : "N/A";
}

function formatMeterLabel(key: string) {
  switch (key) {
    case "tokensMonthly":
      return "Token overage";
    case "apiCalls":
      return "API call overage";
    default:
      return key;
  }
}

function formatMeterState(state: string | null | undefined) {
  switch (state) {
    case "soft_limit_reached":
      return "Overage";
    case "hard_limit_reached":
      return "Hard cap reached";
    case "blocked_past_due":
      return "Blocked: past due";
    case "subscription_missing_meter_price":
      return "Not attached";
    case "ok":
      return "Within limit";
    default:
      return "Unavailable";
  }
}

function getCatalogMeterPrice(
  product: StripeCatalogProduct | null,
  key: string,
) {
  return product?.meterPrices.find((meterPrice) => meterPrice.key === key) ?? null;
}

function getBillableOverageQuantity(
  usage: StripeBillingMeterUsageResult | null,
) {
  if (!usage || typeof usage.includedLimit !== "number" || usage.includedLimit < 0) {
    return null;
  }

  return Math.max(0, usage.currentPeriodUsed - usage.includedLimit);
}

function describeMeterBillingState(
  usage: StripeBillingMeterUsageResult | null,
  key: string,
) {
  if (!usage) {
    return "Stripe meter totals are not available yet for this organization.";
  }

  const overage = getBillableOverageQuantity(usage);
  if (usage.state === "hard_limit_reached") {
    return `${formatMeterLabel(key)} is over the configured demo hard cap for this billing period, so new reports are blocked until the next cycle or a plan change.`;
  }

  if (overage === null) {
    return `${formatMeterLabel(key)} is attached, but this plan does not expose an included allowance for it.`;
  }

  if (overage === 0) {
    return `${formatMeterLabel(key)} is still inside the included monthly allowance, so Stripe shows $0 overage for this metric right now.`;
  }

  return `${formatMeterLabel(key)} has crossed the included monthly allowance, so Stripe bills only the overage amount above the included threshold.`;
}

function mergePendingMeterUsage(
  current: StripeBillingMeterUsageResult | null,
  pending: PendingMeterProjection | null,
): StripeBillingMeterUsageResult | null {
  if (!current || !pending) {
    return current;
  }

  if (Date.now() > pending.pendingUntil) {
    return current;
  }

  if (current.currentPeriodUsed >= pending.projectedCurrentPeriodUsed) {
    return current;
  }

  return {
    ...current,
    currentPeriodUsed: pending.projectedCurrentPeriodUsed,
    remainingIncluded:
      typeof current.includedLimit === "number" && current.includedLimit >= 0
        ? Math.max(0, current.includedLimit - pending.projectedCurrentPeriodUsed)
        : current.remainingIncluded,
    remainingHard:
      typeof current.hardLimit === "number" && current.hardLimit >= 0
        ? Math.max(0, current.hardLimit - pending.projectedCurrentPeriodUsed)
        : current.remainingHard,
    state: (pending.state as StripeBillingMeterUsageResult["state"] | null) ?? current.state,
    warning:
      pending.warning ??
      "Stripe accepted the event, but the Stripe-backed summary can take around 20 seconds to catch up.",
  };
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not set";
  }

  return date.toLocaleString();
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not set";
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatInvoiceLineKind(kind: StripeBillingUpcomingInvoiceLineResult["kind"]) {
  switch (kind) {
    case "base_subscription":
      return "Base plan";
    case "seat_add_on":
      return "Seat add-on";
    case "proration":
      return "Proration";
    case "metered":
      return "Metered usage";
    default:
      return "Other";
  }
}

function formatInvoiceLinePeriod(
  line: StripeBillingUpcomingInvoiceLineResult,
) {
  if (!line.periodStart || !line.periodEnd) {
    return "Period unavailable";
  }

  return `${formatDate(line.periodStart)} - ${formatDate(line.periodEnd)}`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function formatOrganizationCreateError(message: string | null, slug: string) {
  if (!message) {
    return "Organization creation failed.";
  }

  if (/already exists|slug|unique/i.test(message)) {
    return `The organization slug "${slug}" is already taken. Try a different slug, like "${slug}-team" or "${slug}-2".`;
  }

  return message;
}

function slugifyOrganizationName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getPlanProduct(
  products: StripeCatalogProduct[],
  planId: string,
  interval: "month" | "year",
) {
  return products.find(
    (product) =>
      product.planId === planId &&
      product.kind === "subscription" &&
      product.interval === interval,
  );
}

export default function DashboardPage() {
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const [organizations, setOrganizations] = useState<AuthOrganizationRecord[]>([]);
  const [activeOrganization, setActiveOrganizationState] = useState<ActiveOrganizationRecord | null>(
    null,
  );
  const [incomingInvitations, setIncomingInvitations] = useState<AuthOrganizationInvitation[]>(
    [],
  );
  const [billingStatus, setBillingStatus] = useState<StripeBillingStatusResult | null>(null);
  const [billingFeatures, setBillingFeatures] = useState<StripeBillingFeaturesResult | null>(
    null,
  );
  const [billingLimits, setBillingLimits] = useState<StripeBillingLimitsResult | null>(null);
  const [catalogProducts, setCatalogProducts] = useState<StripeCatalogProduct[]>([]);
  const [usageByKey, setUsageByKey] = useState<UsageMap>({
    seats: null,
    projects: null,
    tokensMonthly: null,
  });
  const [checkByKey, setCheckByKey] = useState<CheckMap>({
    seats: null,
    projects: null,
    tokensMonthly: null,
  });
  const [meterUsageByKey, setMeterUsageByKey] = useState<MeterUsageMap>({
    tokensMonthly: null,
    apiCalls: null,
  });
  const [pendingMeterProjectionByKey, setPendingMeterProjectionByKey] =
    useState<PendingMeterProjectionMap>({
      tokensMonthly: null,
      apiCalls: null,
    });
  const [lastMeterReport, setLastMeterReport] = useState<StripeBillingReportUsageResult | null>(
    null,
  );
  const [upcomingInvoice, setUpcomingInvoice] = useState<StripeBillingUpcomingInvoiceResult | null>(
    null,
  );
  const [upcomingInvoiceError, setUpcomingInvoiceError] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [seatUpgradeInput, setSeatUpgradeInput] = useState("");
  const [seatOverrideInput, setSeatOverrideInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedTheme = window.localStorage.getItem("farm-pricing-theme");
    if (storedTheme === "light" || storedTheme === "dark") {
      setThemeMode(storedTheme);
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }

    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem("farm-pricing-theme", themeMode);
  }, [themeMode]);

  useEffect(() => {
    setSeatOverrideInput(
      typeof billingStatus?.seatAllowanceOverride === "number"
        ? String(billingStatus.seatAllowanceOverride)
        : "",
    );
  }, [activeOrganization?.id, billingStatus?.seatAllowanceOverride]);

  useEffect(() => {
    const fallbackQuantity =
      billingStatus?.seatQuantity ??
      usageByKey.seats?.used ??
      billingLimits?.limits?.seats ??
      null;

    setSeatUpgradeInput(
      typeof fallbackQuantity === "number" && fallbackQuantity > 0
        ? String(fallbackQuantity)
        : "",
    );
  }, [activeOrganization?.id, billingStatus?.seatQuantity, usageByKey.seats?.used, billingLimits?.limits?.seats]);

  async function loadBillingState() {
    const [
      statusResult,
      featuresResult,
      limitsResult,
      productsResult,
      seatsUsageResult,
      projectUsageResult,
      tokenUsageResult,
      meteredTokenUsageResult,
      meteredApiCallsResult,
    ] =
      await Promise.all([
        apiClient.billing.status(),
        apiClient.billing.features(),
        apiClient.billing.limits(),
        apiClient.billing.products(),
        apiClient.billing.usage({
          body: {
            key: "seats",
          },
        }),
        apiClient.billing.usage({
          body: {
            key: "projects",
          },
        }),
        apiClient.billing.usage({
          body: {
            key: "tokensMonthly",
          },
        }),
        apiClient.billing.meterUsage({
          body: {
            key: "tokensMonthly",
          },
        }),
        apiClient.billing.meterUsage({
          body: {
            key: "apiCalls",
          },
        }),
      ]);

    if (statusResult.error) {
      setBillingStatus(null);
      setBillingFeatures(null);
      setBillingLimits(null);
      setUsageByKey({
        seats: null,
        projects: null,
        tokensMonthly: null,
      });
      setCheckByKey({
        seats: null,
        projects: null,
        tokensMonthly: null,
      });
      setMeterUsageByKey({
        tokensMonthly: null,
        apiCalls: null,
      });
      setPendingMeterProjectionByKey({
        tokensMonthly: null,
        apiCalls: null,
      });
      setUpcomingInvoice(null);
      setUpcomingInvoiceError(null);
      setCatalogProducts([]);
      return;
    }

    const upcomingInvoiceResult =
      statusResult.data?.stripeSubscriptionId && statusResult.data?.stripeCustomerId
        ? await apiClient.billing.upcomingInvoice()
        : null;

    setBillingStatus(statusResult.data ?? null);
    setBillingFeatures(featuresResult.error ? null : featuresResult.data ?? null);
    setBillingLimits(limitsResult.error ? null : limitsResult.data ?? null);
    setCatalogProducts(productsResult.error ? [] : productsResult.data ?? []);
    setUpcomingInvoice(
      upcomingInvoiceResult?.error ? null : upcomingInvoiceResult?.data ?? null,
    );
    setUpcomingInvoiceError(upcomingInvoiceResult?.error?.message ?? null);

    const nextUsage: UsageMap = {
      seats: seatsUsageResult.error ? null : seatsUsageResult.data ?? null,
      projects: projectUsageResult.error ? null : projectUsageResult.data ?? null,
      tokensMonthly: tokenUsageResult.error ? null : tokenUsageResult.data ?? null,
    };
    setUsageByKey(nextUsage);
    const nextMeterUsage: MeterUsageMap = {
      tokensMonthly: mergePendingMeterUsage(
        meteredTokenUsageResult.error ? null : meteredTokenUsageResult.data ?? null,
        pendingMeterProjectionByKey.tokensMonthly,
      ),
      apiCalls: mergePendingMeterUsage(
        meteredApiCallsResult.error ? null : meteredApiCallsResult.data ?? null,
        pendingMeterProjectionByKey.apiCalls,
      ),
    };
    setMeterUsageByKey(nextMeterUsage);
    setPendingMeterProjectionByKey((current) => ({
      tokensMonthly:
        nextMeterUsage.tokensMonthly &&
        current.tokensMonthly &&
        nextMeterUsage.tokensMonthly.currentPeriodUsed >=
          current.tokensMonthly.projectedCurrentPeriodUsed
          ? null
          : current.tokensMonthly,
      apiCalls:
        nextMeterUsage.apiCalls &&
        current.apiCalls &&
        nextMeterUsage.apiCalls.currentPeriodUsed >= current.apiCalls.projectedCurrentPeriodUsed
          ? null
          : current.apiCalls,
    }));

    const checkResults = await Promise.all([
      apiClient.billing.check({
        body: {
          key: "seats",
          amount: 1,
        },
      }),
      apiClient.billing.check({
        body: {
          key: "projects",
          amount: 1,
        },
      }),
      apiClient.billing.check({
        body: {
          key: "tokensMonthly",
          amount: 25_000,
        },
      }),
    ]);

    const nextChecks: CheckMap = {
      seats: checkResults[0].error ? null : checkResults[0].data ?? null,
      projects: checkResults[1].error ? null : checkResults[1].data ?? null,
      tokensMonthly: checkResults[2].error ? null : checkResults[2].data ?? null,
    };

    setCheckByKey(nextChecks);

    console.log("[stripe-prisma-org-example:dashboard-billing]", {
      status: statusResult.data ?? null,
      features: featuresResult.error ? null : featuresResult.data ?? null,
      limits: limitsResult.error ? null : limitsResult.data ?? null,
      usage: nextUsage,
      checks: nextChecks,
      products: productsResult.error ? [] : productsResult.data ?? [],
    });
  }

  async function refreshMeterTotals() {
    setBusyAction("load");
    try {
      await loadBillingState();
    } finally {
      setBusyAction(null);
    }
  }

  async function loadDashboard() {
    setBusyAction("load");
    setNotice(null);

    try {
      const sessionResponse = await authClient.getSession();
      if (sessionResponse.error || !sessionResponse.data?.user) {
        setSession({ status: "unauthorized" });
        setOrganizations([]);
        setActiveOrganizationState(null);
        setIncomingInvitations([]);
        setBillingStatus(null);
        setBillingFeatures(null);
        setBillingLimits(null);
        setCatalogProducts([]);
        setUsageByKey({
          seats: null,
          projects: null,
          tokensMonthly: null,
        });
        setCheckByKey({
          seats: null,
          projects: null,
          tokensMonthly: null,
        });
        setMeterUsageByKey({
          tokensMonthly: null,
          apiCalls: null,
        });
        setPendingMeterProjectionByKey({
          tokensMonthly: null,
          apiCalls: null,
        });
        setLastMeterReport(null);
        setUpcomingInvoice(null);
        setUpcomingInvoiceError(null);
        return;
      }

      setSession({
        status: "ready",
        user: {
          email: sessionResponse.data.user.email ?? "unknown@farmjs.dev",
          name: sessionResponse.data.user.name ?? "Unknown User",
        },
      });

      const [organizationsResult, activeOrganizationResult, invitationsResult] =
        await Promise.all([
          authOrganizationClient.list(),
          authOrganizationClient.getFullOrganization(),
          authOrganizationClient.listUserInvitations(),
        ]);

      setOrganizations(organizationsResult.data ?? []);
      setIncomingInvitations(invitationsResult.data ?? []);
      setActiveOrganizationState(activeOrganizationResult.data ?? null);

      if (activeOrganizationResult.data) {
        await loadBillingState();
      } else {
        setBillingStatus(null);
        setBillingFeatures(null);
        setBillingLimits(null);
        setCatalogProducts([]);
        setLastMeterReport(null);
        setUpcomingInvoice(null);
        setUpcomingInvoiceError(null);
        setUsageByKey({
          seats: null,
          projects: null,
          tokensMonthly: null,
        });
        setCheckByKey({
          seats: null,
          projects: null,
          tokensMonthly: null,
        });
        setMeterUsageByKey({
          tokensMonthly: null,
          apiCalls: null,
        });
        setPendingMeterProjectionByKey({
          tokensMonthly: null,
          apiCalls: null,
        });
        setUpcomingInvoice(null);
        setUpcomingInvoiceError(null);
      }
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function logout() {
    await authClient.signOut();
    window.location.href = "/";
  }

  async function createOrganization(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAction("create-org");
    setNotice(null);
    const form = event.currentTarget;

    try {
      const formData = new FormData(form);
      const name = String(formData.get("name") || "").trim();
      const slug = String(formData.get("slug") || "").trim() || slugifyOrganizationName(name);

      const result = await authOrganizationClient.create({
        name,
        slug,
      });

      if (result.error || !result.data?.id) {
        setNotice(formatOrganizationCreateError(result.error, slug || "organization"));
        return;
      }

      const activeResult = await authOrganizationClient.setActive(result.data.id);
      if (activeResult.error) {
        setNotice(activeResult.error);
        return;
      }

      form.reset();
      await loadDashboard();
      setNotice(`Created and activated organization "${result.data.name}".`);
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function activateOrganization(organizationId: string) {
    setBusyAction(`set-active:${organizationId}`);
    setNotice(null);

    try {
      const result = await authOrganizationClient.setActive(organizationId);
      if (result.error) {
        setNotice(result.error);
        return;
      }

      await loadDashboard();
      setNotice("Active organization updated.");
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function inviteMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeOrganization) {
      setNotice("Create or activate an organization before inviting members.");
      return;
    }

    setBusyAction("invite-member");
    setNotice(null);
    const form = event.currentTarget;

    try {
      const seatCheck = await apiClient.billing.check({
        body: {
          key: "seats",
          amount: 1,
        },
      });

      if (seatCheck.error) {
        setNotice(seatCheck.error.message);
        return;
      }

      if (!seatCheck.data?.allowed) {
        setNotice(
          `Seat limit reached (${seatCheck.data?.used ?? 0}/${seatCheck.data?.limit ?? 0}). Review the seat upgrade prompt below before inviting another teammate.`,
        );
        return;
      }

      const formData = new FormData(form);
      const email = String(formData.get("email") || "").trim();

      const result = await authOrganizationClient.inviteMember({
        email,
        role: "member",
        organizationId: activeOrganization.id,
      });

      if (result.error) {
        setNotice(result.error);
        return;
      }

      form.reset();
      await loadDashboard();
      setNotice(`Invitation sent to ${email}.`);
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function acceptInvitation(invitationId: string) {
    setBusyAction(`accept:${invitationId}`);
    setNotice(null);

    try {
      const result = await authOrganizationClient.acceptInvitation(invitationId);
      if (result.error) {
        setNotice(result.error);
        return;
      }

      await loadDashboard();
      setNotice("Invitation accepted.");
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function createDemoProject() {
    if (!activeOrganization) {
      setNotice("Create or activate an organization before creating demo projects.");
      return;
    }

    setBusyAction("demo-project");
    setNotice(null);

    try {
      const projectCheck = await apiClient.billing.check({
        body: {
          key: "projects",
          amount: 1,
        },
      });

      if (projectCheck.error) {
        setNotice(projectCheck.error.message);
        return;
      }

      if (!projectCheck.data?.allowed) {
        setNotice(
          `Project limit reached (${projectCheck.data?.used ?? 0}/${projectCheck.data?.limit ?? 0}).`,
        );
        return;
      }

      const result = await apiClient.organization.createProject({
        body: {
          name: `Demo Project ${new Date().toLocaleTimeString()}`,
        },
      });

      if (result.error) {
        setNotice(result.error.message);
        return;
      }

      await loadBillingState();
      setNotice(`Created demo project "${result.data?.name ?? "Unnamed"}".`);
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function spendDemoTokens(tokens: number) {
    if (!activeOrganization) {
      setNotice("Create or activate an organization before recording token usage.");
      return;
    }

    setBusyAction(`tokens:${tokens}`);
    setNotice(null);

    try {
      const tokenCheck = await apiClient.billing.check({
        body: {
          key: "tokensMonthly",
          amount: tokens,
        },
      });

      if (tokenCheck.error) {
        setNotice(tokenCheck.error.message);
        return;
      }

      if (!tokenCheck.data?.allowed) {
        setNotice(
          `Token limit reached (${tokenCheck.data?.used ?? 0}/${tokenCheck.data?.limit ?? 0}).`,
        );
        return;
      }

      const result = await apiClient.organization.recordTokenUsage({
        body: {
          tokens,
        },
      });

      if (result.error) {
        setNotice(result.error.message);
        return;
      }

      await loadBillingState();
      setNotice(`Recorded ${tokens.toLocaleString()} demo tokens for the active organization.`);
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function reportMeteredTokens(tokens: number) {
    if (!activeOrganization) {
      setNotice("Create or activate an organization before reporting meter usage.");
      return;
    }

    if (!billingStatus?.stripeCustomerId) {
      setNotice("Subscribe this organization before reporting Stripe meter usage.");
      return;
    }

    setBusyAction(`report-tokens:${tokens}`);
    setNotice(null);

    try {
      const result = await apiClient.billing.reportUsage({
        body: {
          key: "tokensMonthly",
          quantity: tokens,
          idempotencyKey: `demo-token-meter:${activeOrganization.id}:${tokens}:${Date.now()}`,
          properties: {
            source: "dashboard-demo",
          },
        },
      });

      if (result.error) {
        setNotice(result.error.message);
        return;
      }

      const report = result.data;
      setMeterUsageByKey((current) => ({
        ...current,
        tokensMonthly:
          current.tokensMonthly && typeof report?.projectedCurrentPeriodUsed === "number"
            ? {
                ...current.tokensMonthly,
                currentPeriodUsed: report.projectedCurrentPeriodUsed,
                remainingIncluded:
                  typeof current.tokensMonthly.includedLimit === "number" &&
                  current.tokensMonthly.includedLimit >= 0
                    ? Math.max(
                        0,
                        current.tokensMonthly.includedLimit - report.projectedCurrentPeriodUsed,
                      )
                    : null,
                remainingHard:
                  typeof report.hardLimit === "number" && report.hardLimit >= 0
                    ? Math.max(0, report.hardLimit - report.projectedCurrentPeriodUsed)
                    : current.tokensMonthly.remainingHard,
                softLimit: report.softLimit ?? current.tokensMonthly.softLimit,
                hardLimit: report.hardLimit ?? current.tokensMonthly.hardLimit,
                state: report.state ?? current.tokensMonthly.state,
                warning: report.warning ?? current.tokensMonthly.warning,
              }
            : current.tokensMonthly,
      }));
      if (report && typeof report.projectedCurrentPeriodUsed === "number") {
        const projected = report.projectedCurrentPeriodUsed;
        setPendingMeterProjectionByKey((current) => ({
          ...current,
          tokensMonthly: {
            projectedCurrentPeriodUsed: projected,
            pendingUntil: Date.now() + 45_000,
            state: report.state ?? current.tokensMonthly?.state ?? null,
            warning:
              report.warning ??
              "Stripe accepted the event. The Stripe-backed total can take around 20 seconds to catch up.",
          },
        }));
      }
      setNotice(
        `Reported ${tokens.toLocaleString()} Stripe-metered tokens to "${report?.stripeEventName}". The Stripe-backed total and next-bill preview can take around 20 seconds to catch up, so use Refresh Meter Totals if you want to verify the invoice impact.`,
      );
      setLastMeterReport(report ?? null);
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function reportMeteredApiCall() {
    if (!activeOrganization) {
      setNotice("Create or activate an organization before reporting meter usage.");
      return;
    }

    if (!billingStatus?.stripeCustomerId) {
      setNotice("Subscribe this organization before reporting Stripe meter usage.");
      return;
    }

    setBusyAction("report-api-call");
    setNotice(null);

    try {
      const result = await apiClient.billing.reportUsage({
        body: {
          key: "apiCalls",
          quantity: 1,
          idempotencyKey: `demo-api-call-meter:${activeOrganization.id}:${Date.now()}`,
          properties: {
            source: "dashboard-demo",
            route: "/api/demo",
          },
        },
      });

      if (result.error) {
        setNotice(result.error.message);
        return;
      }

      const report = result.data;
      setMeterUsageByKey((current) => ({
        ...current,
        apiCalls:
          current.apiCalls && typeof report?.projectedCurrentPeriodUsed === "number"
            ? {
                ...current.apiCalls,
                currentPeriodUsed: report.projectedCurrentPeriodUsed,
                remainingIncluded:
                  typeof current.apiCalls.includedLimit === "number" &&
                  current.apiCalls.includedLimit >= 0
                    ? Math.max(
                        0,
                        current.apiCalls.includedLimit - report.projectedCurrentPeriodUsed,
                      )
                    : null,
                remainingHard:
                  typeof report.hardLimit === "number" && report.hardLimit >= 0
                    ? Math.max(0, report.hardLimit - report.projectedCurrentPeriodUsed)
                    : current.apiCalls.remainingHard,
                softLimit: report.softLimit ?? current.apiCalls.softLimit,
                hardLimit: report.hardLimit ?? current.apiCalls.hardLimit,
                state: report.state ?? current.apiCalls.state,
                warning: report.warning ?? current.apiCalls.warning,
              }
            : current.apiCalls,
      }));
      if (report && typeof report.projectedCurrentPeriodUsed === "number") {
        const projected = report.projectedCurrentPeriodUsed;
        setPendingMeterProjectionByKey((current) => ({
          ...current,
          apiCalls: {
            projectedCurrentPeriodUsed: projected,
            pendingUntil: Date.now() + 45_000,
            state: report.state ?? current.apiCalls?.state ?? null,
            warning:
              report.warning ??
              "Stripe accepted the event. The Stripe-backed total can take around 20 seconds to catch up.",
          },
        }));
      }
      setNotice(
        `Reported 1 Stripe-metered API call to "${report?.stripeEventName}". Refresh Meter Totals in a few seconds if you want to compare the accepted event with the next-bill preview.`,
      );
      setLastMeterReport(report ?? null);
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function openBillingPortal() {
    if (!billingStatus?.stripeCustomerId) {
      setNotice("Subscribe the active organization before opening the billing portal.");
      return;
    }

    setBusyAction("billing-portal");
    setNotice(null);

    try {
      const result = await apiClient.billing.portal({
        body: {
          customerId: billingStatus.stripeCustomerId,
          returnTo: "/dashboard",
        },
      });

      if (result.error) {
        setNotice(result.error.message);
        return;
      }

      if (result.data?.redirectTo) {
        window.location.assign(result.data.redirectTo);
        return;
      }
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function updatePurchasedSeats(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeOrganization) {
      setNotice("Create or activate an organization before updating seats.");
      return;
    }

    if (!billingStatus?.stripeSubscriptionId) {
      setNotice("Subscribe this organization before changing purchased seats.");
      return;
    }

    setBusyAction("seat-upgrade");
    setNotice(null);

    try {
      const parsedQuantity = Number.parseInt(seatUpgradeInput.trim(), 10);
      if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
        setNotice("Enter a whole-number seat quantity greater than zero.");
        return;
      }

      const result = await apiClient.billing.upgrade({
        body: {
          quantity: parsedQuantity,
          prorationBehavior: "create_prorations",
        },
      });

      if (result.error) {
        setNotice(result.error.message);
        return;
      }

      await loadBillingState();
      setNotice(
        `Purchased seats updated to ${parsedQuantity}. This updates the existing Stripe subscription in place, so there is no Checkout redirect. Review the Stripe subscription or upcoming invoice to see any proration or renewal impact.`,
      );
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function updateSeatOverride(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeOrganization) {
      setNotice("Create or activate an organization before editing seat overrides.");
      return;
    }

    setBusyAction("seat-override");
    setNotice(null);

    try {
      const rawValue = seatOverrideInput.trim();
      const parsedValue =
        rawValue.length === 0 ? null : Number.parseInt(rawValue, 10);

      if (
        parsedValue !== null &&
        (!Number.isInteger(parsedValue) || parsedValue < 0)
      ) {
        setNotice("Seat override must be blank or a whole number greater than or equal to zero.");
        return;
      }

      const result = await apiClient.organization.setSeatOverride({
        body: {
          seatAllowanceOverride: parsedValue,
        },
      });

      if (result.error) {
        setNotice(result.error.message);
        return;
      }

      await loadBillingState();
      setNotice(
        parsedValue === null
          ? "Seat override cleared."
          : `Seat override set to ${parsedValue}.`,
      );
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  const currentPlanId = billingStatus?.planId ?? "free";
  const canOpenBillingPortal = Boolean(
    billingFeatures?.features.billingPortal && billingStatus?.stripeCustomerId,
  );
  const isSeatLimitReached =
    Boolean(activeOrganization) && checkByKey.seats?.allowed === false;
  const currentBillingProduct =
    billingStatus?.productId
      ? catalogProducts.find((product) => product.id === billingStatus.productId) ?? null
      : null;
  const currentMonthlyProduct =
    currentPlanId !== "free" ? getPlanProduct(catalogProducts, currentPlanId, "month") : null;
  const currentYearlyProduct =
    currentPlanId !== "free" ? getPlanProduct(catalogProducts, currentPlanId, "year") : null;
  const proMonthlyProduct = getPlanProduct(catalogProducts, "pro", "month");
  const proYearlyProduct = getPlanProduct(catalogProducts, "pro", "year");
  const businessMonthlyProduct = getPlanProduct(catalogProducts, "business", "month");
  const businessYearlyProduct = getPlanProduct(catalogProducts, "business", "year");
  const includedSeatsForCurrentProduct =
    currentBillingProduct?.seatBilling === "included_plus_add_on"
      ? currentBillingProduct.quantity
      : billingStatus?.seatQuantity ?? null;
  const extraSeatPriceLabel =
    currentBillingProduct?.hasSeatPrice && currentBillingProduct.seatUnitAmount != null
      ? `${formatMoney(
          currentBillingProduct.seatUnitAmount,
          currentBillingProduct.seatCurrency ?? "usd",
        )} per extra seat / ${
          currentBillingProduct.interval === "year" ? "year" : "month"
        }`
      : null;
  const usagePricingReferenceProducts = [proMonthlyProduct, businessMonthlyProduct].filter(
    (product): product is StripeCatalogProduct => Boolean(product),
  );
  const currentMonthlyPricingProduct =
    currentBillingProduct?.interval === "month" ? currentBillingProduct : currentMonthlyProduct;
  const currentPlanHighlights =
    monthlyPlanHighlights[currentPlanId as keyof typeof monthlyPlanHighlights] ??
    monthlyPlanHighlights.free;
  const currentAdditionalPricing =
    currentMonthlyPricingProduct == null
      ? []
      : [
          ...(currentMonthlyPricingProduct.seatUnitAmount != null
            ? [
                `Extra seats: ${formatMoney(
                  currentMonthlyPricingProduct.seatUnitAmount,
                  currentMonthlyPricingProduct.seatCurrency ?? "usd",
                )} / seat / month`,
              ]
            : []),
          ...currentMonthlyPricingProduct.meterPrices.map(
            (meterPrice) =>
              `${formatMeterLabel(meterPrice.key)}: ${
                meterPrice.summary ?? "Additional usage pricing"
              }`,
          ),
        ];
  const currentTokenMeterPrice = getCatalogMeterPrice(
    currentMonthlyPricingProduct ?? null,
    "tokensMonthly",
  );
  const currentApiMeterPrice = getCatalogMeterPrice(
    currentMonthlyPricingProduct ?? null,
    "apiCalls",
  );
  const currentTokenMeterUsage = meterUsageByKey.tokensMonthly;
  const currentApiMeterUsage = meterUsageByKey.apiCalls;
  const currentTokenBillableOverage = getBillableOverageQuantity(currentTokenMeterUsage);
  const currentApiBillableOverage = getBillableOverageQuantity(currentApiMeterUsage);
  const upcomingInvoiceCurrency =
    upcomingInvoice?.currency ?? currentMonthlyPricingProduct?.currency ?? "usd";
  const overageTestTokenAmount = currentPlanId === "business" ? 10_500_000 : 1_250_000;
  const overageTestLabel =
    currentPlanId === "business"
      ? "Report 10.5M Stripe Metered Tokens"
      : "Report 1.25M Stripe Metered Tokens";

  return (
    <main className="page-shell page-shell-wide">
      <section className="hero">
        <div className="hero-toolbar">
          <span className="eyebrow">Organization Dashboard</span>
          <div className="theme-toggle" aria-label="Theme mode">
            {(["light", "dark"] as const).map((mode) => (
              <button
                key={mode}
                className={`theme-toggle-button${themeMode === mode ? " is-active" : ""}`}
                onClick={() => setThemeMode(mode)}
                type="button"
              >
                {mode === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
        </div>
        <h1>Org Billing + Better Auth</h1>
        <p>
          Create an organization, activate it in the current session, invite teammates, and
          inspect how billing features, limits, and usage resolve against that active org.
        </p>
        {session.status === "ready" ? (
          <>
            <div className="action-row hero-action-row">
              <a className="secondary-link" href="/">
                View Pricing
              </a>
              {canOpenBillingPortal ? (
                <button
                  className="secondary-button"
                  disabled={busyAction === "billing-portal"}
                  onClick={() => void openBillingPortal()}
                  type="button"
                >
                  {busyAction === "billing-portal" ? "Opening..." : "Manage Billing"}
                </button>
              ) : null}
            </div>
            {activeOrganization ? (
              <p className="hero-meta">
                Active billing owner: <strong>{activeOrganization.name}</strong>
                {billingStatus?.planId ? ` · Plan ${formatPlanName(billingStatus.planId)}` : ""}
                {canOpenBillingPortal ? " · Billing portal opens for this org" : ""}
              </p>
            ) : null}
          </>
        ) : null}
      </section>

      {notice ? <div className="notice notice-success">{notice}</div> : null}

      <section className="dashboard-grid">
        <section className="card">
          <h2>Session</h2>
          {session.status === "loading" ? <p>Loading session...</p> : null}
          {session.status === "unauthorized" ? (
            <>
              <p>You need to sign in before accessing the organization dashboard.</p>
              <a className="primary-link" href="/sign-in">
                Go to Sign In
              </a>
            </>
          ) : null}
          {session.status === "ready" ? (
            <>
              <div className="session-stack">
                <div className="session-line">
                  <strong>User</strong>
                  <span>{session.user.name}</span>
                </div>
                <div className="session-line">
                  <strong>Email</strong>
                  <span>{session.user.email}</span>
                </div>
                <div className="session-line">
                  <strong>Active Organization</strong>
                  <span>{activeOrganization?.name ?? "None selected yet"}</span>
                </div>
              </div>
              <div className="action-row">
                <button className="primary-button" onClick={logout} type="button">
                  Logout
                </button>
                <a className="secondary-link" href="/">
                  Back to Pricing
                </a>
              </div>
            </>
          ) : null}
        </section>

        <section className="card">
          <h2>Create Organization</h2>
          <p>Create a Better Auth organization, then Farm will bill the active org.</p>
          <form className="mock-form" onSubmit={createOrganization}>
            <label>
              Organization Name
              <input defaultValue="Acme Team" name="name" type="text" />
            </label>
            <label>
              Slug
              <input name="slug" placeholder="acme-team-jane" type="text" />
            </label>
            <button
              className="primary-button"
              disabled={busyAction === "create-org"}
              type="submit"
            >
              {busyAction === "create-org" ? "Creating..." : "Create Organization"}
            </button>
          </form>
        </section>

        <section className="card">
          <h2>Your Organizations</h2>
          {organizations.length === 0 ? (
            <p>No organizations yet. Create one to start testing org-owned billing.</p>
          ) : (
            <div className="session-stack">
              {organizations.map((organization) => (
                <div className="session-line" key={organization.id}>
                  <div className="line-copy">
                    <strong>{organization.name}</strong>
                    <span>{organization.slug}</span>
                  </div>
                  <button
                    className="secondary-button"
                    disabled={busyAction === `set-active:${organization.id}`}
                    onClick={() => void activateOrganization(organization.id)}
                    type="button"
                  >
                    {activeOrganization?.id === organization.id ? "Active" : "Set Active"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h2>Invite Member</h2>
          <p>
            This example checks <code>billing.check(&quot;seats&quot;, 1)</code> before it
            sends the Better Auth invitation.
          </p>
          <p>
            Sent invites show up on the active organization below. The incoming invitation card
            only shows invites for the currently signed-in user's email.
          </p>
          <form className="mock-form" onSubmit={inviteMember}>
            <label>
              Teammate Email
              <input defaultValue="teammate@farmjs.dev" name="email" type="email" />
            </label>
            <button
              className="primary-button"
              disabled={!activeOrganization || busyAction === "invite-member"}
              type="submit"
            >
              {busyAction === "invite-member" ? "Sending..." : "Invite Member"}
            </button>
          </form>
          <div className="session-stack">
            <div className="session-line">
              <strong>Seat Usage</strong>
              <span>
                {formatUsageValue(usageByKey.seats?.used)} / {formatLimit(usageByKey.seats?.limit)}
              </span>
            </div>
            <div className="session-line">
              <strong>Seat Check +1</strong>
              <span>{checkByKey.seats?.allowed ? "Allowed" : "Blocked"}</span>
            </div>
          </div>
          {isSeatLimitReached ? (
            <div className="notice notice-error">
              This organization is out of seats. Scroll to the seat upgrade prompt on this page
              to review pricing and decide whether to update the Stripe subscription or use the
              demo-only manual override below.
            </div>
          ) : null}
        </section>

        {isSeatLimitReached ? (
          <section className="card">
            <h2>Seat Upgrade Prompt</h2>
            {currentPlanId === "free" ? (
              <>
                <p>
                  Free is full at {formatUsageValue(usageByKey.seats?.used)} of{" "}
                  {formatLimit(billingLimits?.limits.seats)} seats. Upgrade this org to a paid
                  plan to unlock more capacity.
                </p>
                <div className="session-stack">
                  <div className="session-line">
                    <strong>Pro</strong>
                    <span>
                      {formatAmount(proMonthlyProduct?.unitAmount)} monthly or{" "}
                      {formatAmount(proYearlyProduct?.unitAmount)} yearly
                    </span>
                  </div>
                  <div className="session-line">
                    <strong>Business</strong>
                    <span>
                      {formatAmount(businessMonthlyProduct?.unitAmount)} monthly or{" "}
                      {formatAmount(businessYearlyProduct?.unitAmount)} yearly
                    </span>
                  </div>
                </div>
                <div className="action-row">
                  <a className="primary-link" href="/">
                    Review Pricing
                  </a>
                </div>
              </>
            ) : (
              <>
                <p>
                  {formatPlanName(currentPlanId)} is full at {formatUsageValue(usageByKey.seats?.used)}{" "}
                  of {formatLimit(billingLimits?.limits.seats)} seats. Purchased seat quantity now
                  comes from the real Stripe subscription. This prompt updates that existing
                  subscription in place instead of opening a new Stripe Checkout session.
                </p>
                <div className="session-stack">
                  <div className="session-line">
                    <strong>{formatPlanName(currentPlanId)} Monthly</strong>
                    <span>{formatAmount(currentMonthlyProduct?.unitAmount)}</span>
                  </div>
                  <div className="session-line">
                    <strong>{formatPlanName(currentPlanId)} Yearly</strong>
                    <span>{formatAmount(currentYearlyProduct?.unitAmount)}</span>
                  </div>
                  <div className="session-line">
                    <strong>Current Purchased Seats</strong>
                    <span>{formatUsageValue(billingStatus?.seatQuantity)}</span>
                  </div>
                  <div className="session-line">
                    <strong>Included Seats</strong>
                    <span>{formatUsageValue(includedSeatsForCurrentProduct)}</span>
                  </div>
                  <div className="session-line">
                    <strong>Extra Seat Pricing</strong>
                    <span>{extraSeatPriceLabel ?? "Configure the Stripe seat add-on price to enable paid seat upgrades."}</span>
                  </div>
                </div>
                <form className="mock-form" onSubmit={updatePurchasedSeats}>
                  <label>
                    Total Seats To Purchase
                    <input
                      min={includedSeatsForCurrentProduct ?? 1}
                      step={1}
                      type="number"
                      value={seatUpgradeInput}
                      onChange={(event) => setSeatUpgradeInput(event.target.value)}
                    />
                  </label>
                  <div className="action-row">
                    <button
                      className="primary-button"
                      disabled={
                        !billingStatus?.stripeSubscriptionId ||
                        !currentBillingProduct ||
                        (currentBillingProduct.seatBilling === "included_plus_add_on" &&
                          !currentBillingProduct.hasSeatPrice) ||
                        busyAction === "seat-upgrade"
                      }
                      type="submit"
                    >
                      {busyAction === "seat-upgrade" ? "Updating..." : "Upgrade Seats"}
                    </button>
                    {canOpenBillingPortal ? (
                      <button
                        className="secondary-button"
                        disabled={busyAction === "billing-portal"}
                        onClick={() => void openBillingPortal()}
                        type="button"
                      >
                        {busyAction === "billing-portal" ? "Opening..." : "Open Billing Portal"}
                      </button>
                    ) : null}
                    <a className="secondary-link" href="/">
                      Review Base Pricing
                    </a>
                  </div>
                </form>
                <p className="pricing-seat-note">
                  The upgrade button changes the real Stripe subscription quantity behind this org.
                  It does not redirect to Stripe Checkout. Stripe records the billing impact on the
                  subscription itself and may show prorations or renewal changes on the upcoming
                  invoice. If you want this to charge paid add-on seats, add the matching recurring
                  seat price id to the example env first. The manual override below remains
                  available as a demo-only app-owned escape hatch.
                </p>
              </>
            )}
          </section>
        ) : null}

        <section className="card">
          <h2>Active Org Invitations</h2>
          {!activeOrganization ? (
            <p>Create or activate an organization to inspect sent invites.</p>
          ) : activeOrganization.invitations.length === 0 ? (
            <p>No invitations have been sent from this organization yet.</p>
          ) : (
            <div className="session-stack">
              {activeOrganization.invitations.map((invitation) => (
                <div className="session-line" key={invitation.id}>
                  <div className="line-copy">
                    <strong>{invitation.email}</strong>
                    <span>
                      {invitation.role ?? "member"} • {invitation.status}
                    </span>
                  </div>
                  <span>{new Date(invitation.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h2>Your Incoming Invitations</h2>
          {incomingInvitations.length === 0 ? (
            <p>No invitations addressed to your current signed-in email yet.</p>
          ) : (
            <div className="session-stack">
              {incomingInvitations.map((invitation) => (
                <div className="session-line" key={invitation.id}>
                  <div className="line-copy">
                    <strong>{invitation.organizationName ?? invitation.organizationId}</strong>
                    <span>{invitation.email}</span>
                  </div>
                  <button
                    className="secondary-button"
                    disabled={busyAction === `accept:${invitation.id}`}
                    onClick={() => void acceptInvitation(invitation.id)}
                    type="button"
                  >
                    {busyAction === `accept:${invitation.id}` ? "Accepting..." : "Accept"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h2>Active Org Billing</h2>
          {!activeOrganization ? (
            <p>Create or activate an organization to load billing state.</p>
          ) : (
            <>
              <div className="session-stack">
                <div className="session-line">
                  <strong>Organization</strong>
                  <span>{activeOrganization.name}</span>
                </div>
                <div className="session-line">
                  <strong>Plan</strong>
                  <span>{formatPlanName(billingStatus?.planId ?? "free")}</span>
                </div>
                <div className="session-line">
                  <strong>Status</strong>
                  <span>{billingStatus?.status ?? "free"}</span>
                </div>
                <div className="session-line">
                  <strong>Seat Mode</strong>
                  <span>{formatSeatMode(billingStatus?.seatMode)}</span>
                </div>
                <div className="session-line">
                  <strong>Purchased Seats</strong>
                  <span>{formatUsageValue(billingStatus?.seatQuantity)}</span>
                </div>
                <div className="session-line">
                  <strong>Seat Override</strong>
                  <span>{formatUsageValue(billingStatus?.seatAllowanceOverride)}</span>
                </div>
                <div className="session-line">
                  <strong>Seat Limit Source</strong>
                  <span>{formatSeatLimitSource(billingStatus?.seatLimitSource)}</span>
                </div>
                <div className="session-line">
                  <strong>Stripe Customer</strong>
                  <span>{billingStatus?.stripeCustomerId ?? "Not linked yet"}</span>
                </div>
                <div className="session-line">
                  <strong>Trial Ends</strong>
                  <span>{formatDateTime(billingStatus?.trialEndsAt)}</span>
                </div>
                <div className="session-line">
                  <strong>Trial Used</strong>
                  <span>{formatDateTime(billingStatus?.trialUsedAt)}</span>
                </div>
              </div>
              <div className="action-row">
                <a className="primary-link" href="/">
                  Open Pricing
                </a>
                  <button
                    className="secondary-button"
                    disabled={!canOpenBillingPortal || busyAction === "billing-portal"}
                    onClick={() => void openBillingPortal()}
                    type="button"
                  >
                  {busyAction === "billing-portal" ? "Opening..." : "Billing Portal"}
                </button>
              </div>
            </>
          )}
        </section>

        <section className="card">
          <h2>Seat Override (Demo/Admin)</h2>
          <p>
            This demo keeps seat usage app-owned, but also lets you apply a manual
            <code> seatAllowanceOverride</code> on the billing snapshot. This is separate from the
            real Stripe seat purchase flow above. Leave it blank to fall back to plan limits or
            subscription quantity.
          </p>
          <form className="mock-form" onSubmit={updateSeatOverride}>
            <label>
              Manual Seat Override
              <input
                min={0}
                step={1}
                type="number"
                value={seatOverrideInput}
                onChange={(event) => setSeatOverrideInput(event.target.value)}
              />
            </label>
            <div className="action-row">
              <button
                className="primary-button"
                disabled={!activeOrganization || busyAction === "seat-override"}
                type="submit"
              >
                {busyAction === "seat-override" ? "Saving..." : "Save Override"}
              </button>
              <button
                className="secondary-button"
                disabled={!activeOrganization || busyAction === "seat-override"}
                onClick={() => setSeatOverrideInput("")}
                type="button"
              >
                Reset Input
              </button>
            </div>
          </form>
          <div className="session-stack">
            <div className="session-line">
              <strong>Effective Seat Limit</strong>
              <span>{formatLimit(billingLimits?.limits?.seats)}</span>
            </div>
            <div className="session-line">
              <strong>Current Source</strong>
              <span>{formatSeatLimitSource(billingStatus?.seatLimitSource)}</span>
            </div>
          </div>
        </section>

        <section className="card">
          <h2>Features + Limits</h2>
          {!activeOrganization ? (
            <p>Activate an organization to inspect the current plan configuration.</p>
          ) : (
            <div className="detail-grid">
              <div>
                <h3>Features</h3>
                <div className="tag-list">
                  {Object.entries(billingFeatures?.features ?? {}).map(([key, enabled]) => (
                    <span className={`tag${enabled ? " tag-success" : ""}`} key={key}>
                      {key}: {enabled ? "on" : "off"}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <h3>Limits</h3>
                <div className="session-stack">
                  {Object.entries(billingLimits?.limits ?? {}).map(([key, value]) => (
                    <div className="session-line" key={key}>
                      <strong>{key}</strong>
                      <span>{formatLimit(typeof value === "number" ? value : null)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="card">
          <h2>Usage + Testing</h2>
          {!activeOrganization ? (
            <p>Billing usage appears once the active organization is set.</p>
          ) : (
            <>
              <div className="detail-grid">
                <div className="mode-box">
                  <strong>Local demo usage</strong>
                  <p>
                    These example-only actions write to the local demo database. They drive
                    <code> /billing/usage</code> and <code>/billing/check</code>, but they never
                    touch Stripe or your invoice preview.
                  </p>
                  <div className="session-stack">
                    <div className="session-line">
                      <strong>Seats</strong>
                      <span>
                        {formatUsageValue(usageByKey.seats?.used)} used • next invite{" "}
                        {checkByKey.seats?.allowed ? "allowed" : "blocked"}
                      </span>
                    </div>
                    <div className="session-line">
                      <strong>Projects</strong>
                      <span>
                        {formatUsageValue(usageByKey.projects?.used)} used • next project{" "}
                        {checkByKey.projects?.allowed ? "allowed" : "blocked"}
                      </span>
                    </div>
                    <div className="session-line">
                      <strong>Local Demo Tokens</strong>
                      <span>
                        {formatUsageValue(usageByKey.tokensMonthly?.used)} used • next 25k{" "}
                        {checkByKey.tokensMonthly?.allowed ? "allowed" : "blocked"}
                      </span>
                    </div>
                  </div>
                  <div className="action-row">
                    <button
                      className="secondary-button"
                      disabled={!activeOrganization || busyAction === "demo-project"}
                      onClick={() => void createDemoProject()}
                      type="button"
                    >
                      {busyAction === "demo-project" ? "Creating..." : "Create Demo Project"}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={!activeOrganization || busyAction === "tokens:25000"}
                      onClick={() => void spendDemoTokens(25_000)}
                      type="button"
                    >
                      {busyAction === "tokens:25000"
                        ? "Recording..."
                        : "Add 25k Local Demo Tokens"}
                    </button>
                  </div>
                </div>

                <div className="mode-box">
                  <strong>Stripe metered billing</strong>
                  <p>
                    These actions call <code>billing.reportUsage()</code> and send real Stripe
                    meter events for the active paid subscription. They update the Stripe-backed
                    totals and the next-bill preview, not the local demo token counter.
                  </p>
                  {currentBillingProduct?.interval === "year" ? (
                    <p className="pricing-seat-note">
                      This demo only auto-attaches token and API-call meters on the monthly Pro and
                      Business products. Yearly plans still preview fixed recurring pricing plus
                      seats.
                    </p>
                  ) : null}
                  <div className="session-stack">
                    <div className="session-line">
                      <strong>Stripe Metered Tokens</strong>
                      <span>
                        {meterUsageByKey.tokensMonthly
                          ? `${formatWholeNumber(
                              meterUsageByKey.tokensMonthly.currentPeriodUsed,
                            )} this period • ${formatMeterState(
                              meterUsageByKey.tokensMonthly.state,
                            )}`
                          : "Unavailable until a metered monthly subscription is active"}
                      </span>
                    </div>
                    <div className="session-line">
                      <strong>Stripe Metered API Calls</strong>
                      <span>
                        {meterUsageByKey.apiCalls
                          ? `${formatWholeNumber(
                              meterUsageByKey.apiCalls.currentPeriodUsed,
                            )} this period • ${formatMeterState(
                              meterUsageByKey.apiCalls.state,
                            )}`
                          : "Unavailable until a metered monthly subscription is active"}
                      </span>
                    </div>
                  </div>
                  <div className="action-row">
                    <button
                      className="secondary-button"
                      disabled={
                        !activeOrganization ||
                        !billingStatus?.stripeCustomerId ||
                        busyAction === "report-tokens:25000"
                      }
                      onClick={() => void reportMeteredTokens(25_000)}
                      type="button"
                    >
                      {busyAction === "report-tokens:25000"
                        ? "Reporting..."
                        : "Report 25k Stripe Metered Tokens"}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={
                        !activeOrganization ||
                        !billingStatus?.stripeCustomerId ||
                        busyAction === `report-tokens:${overageTestTokenAmount}`
                      }
                      onClick={() => void reportMeteredTokens(overageTestTokenAmount)}
                      type="button"
                    >
                      {busyAction === `report-tokens:${overageTestTokenAmount}`
                        ? "Reporting..."
                        : overageTestLabel}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={
                        !activeOrganization ||
                        !billingStatus?.stripeCustomerId ||
                        busyAction === "report-api-call"
                      }
                      onClick={() => void reportMeteredApiCall()}
                      type="button"
                    >
                      {busyAction === "report-api-call"
                        ? "Reporting..."
                        : "Report 1 Stripe Metered API Call"}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={!activeOrganization || busyAction === "load"}
                      onClick={() => void refreshMeterTotals()}
                      type="button"
                    >
                      {busyAction === "load" ? "Refreshing..." : "Refresh Meter Totals"}
                    </button>
                  </div>
                </div>
              </div>
              <p>
                The quickest mental model is: <strong>local demo usage</strong> is for testing app
                limits and checks, while <strong>Stripe metered billing</strong> is what changes
                Stripe-backed totals and the upcoming invoice.
              </p>
            </>
          )}
          <p className="pricing-seat-note">
            Meter reporting v1 sends events directly to Stripe with no local meter-event tables.
            To see Stripe accept these events, create Stripe meters with the event names
            <code> ai_tokens</code> and <code> api_calls</code>. The <code>25k</code> Stripe token
            button is only a smoke test. If you want invoice impact, use the larger Stripe token
            button so you cross the current monthly included threshold.
          </p>
          {lastMeterReport ? (
            <div className="mode-box">
              <strong>Last Stripe meter event</strong>
              <p>
                {lastMeterReport.key} • {lastMeterReport.quantity.toLocaleString()} units •{" "}
                {lastMeterReport.stripeEventName}
              </p>
              <p>
                Identifier: <code>{lastMeterReport.stripeEventIdentifier}</code>
              </p>
              <p>Occurred at: {formatDateTime(lastMeterReport.occurredAt)}</p>
            </div>
          ) : null}
        </section>

        <section className="card dashboard-span-full">
          <div className="pricing-heading">
            <h2>Next Stripe Bill</h2>
            <p>
              This preview comes from Stripe's upcoming invoice API so you can verify prorations,
              recurring items, and metered overage without leaving the app.
            </p>
          </div>

          {!activeOrganization ? (
            <p>Activate an organization to load the next Stripe bill preview.</p>
          ) : upcomingInvoice ? (
            <>
              <div className="detail-grid invoice-summary-grid">
                <div className="mode-box">
                  <strong>Estimated total</strong>
                  <p className="invoice-total-amount">
                    {formatMoney(upcomingInvoice.totals.total, upcomingInvoiceCurrency)}
                  </p>
                  <p>Next billing date: {formatDate(upcomingInvoice.nextBillingAt)}</p>
                </div>
                <div className="mode-box">
                  <strong>Recurring charges</strong>
                  <p className="invoice-total-amount">
                    {formatMoney(upcomingInvoice.totals.recurring, upcomingInvoiceCurrency)}
                  </p>
                  <p>Base subscription plus seat add-ons for the next renewal.</p>
                </div>
                <div className="mode-box">
                  <strong>Prorations</strong>
                  <p className="invoice-total-amount">
                    {formatMoney(upcomingInvoice.totals.prorations, upcomingInvoiceCurrency)}
                  </p>
                  <p>Catch-up charges or credits created mid-cycle.</p>
                </div>
                <div className="mode-box">
                  <strong>Metered overage</strong>
                  <p className="invoice-total-amount">
                    {formatMoney(upcomingInvoice.totals.metered, upcomingInvoiceCurrency)}
                  </p>
                  <p>
                    Recorded Stripe meter usage above the included threshold for this billing
                    period.
                  </p>
                </div>
              </div>

              {upcomingInvoice.note ? (
                <p className="pricing-seat-note">{upcomingInvoice.note}</p>
              ) : null}

              <div className="usage-pricing-block">
                <strong>Preview line items</strong>
                <div className="invoice-line-list">
                  {upcomingInvoice.lines.map((line, index) => (
                    <div className="invoice-line-item" key={`${line.description ?? "line"}:${index}`}>
                      <div>
                        <strong>{line.description ?? "Stripe line item"}</strong>
                        <span>
                          {formatInvoiceLineKind(line.kind)} • {formatInvoiceLinePeriod(line)}
                        </span>
                      </div>
                      <div>
                        <strong>{formatMoney(line.amount, line.currency ?? upcomingInvoiceCurrency)}</strong>
                        <span>
                          {typeof line.quantity === "number"
                            ? `${line.quantity.toLocaleString()} units`
                            : "Quantity unavailable"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p>
              {upcomingInvoiceError ??
                "Subscribe the active organization to a paid Stripe plan before loading an invoice preview."}
            </p>
          )}
        </section>

        <section className="card dashboard-span-full">
          <div className="pricing-heading">
            <h2>Usage Pricing</h2>
            <p>
              Keep the operational view here on the dashboard: live organization consumption on
              one side, monthly plan pricing and overage details on the other.
            </p>
          </div>

          <div className="usage-pricing-shell">
            <div className="usage-pricing-grid">
              <article className="usage-pricing-card usage-pricing-card-current">
                <div className="pricing-plan-topline">
                  <span className="pricing-plan-badge pricing-plan-badge-pro">
                    Current Organization
                  </span>
                  <strong className="usage-pricing-price">
                    {activeOrganization?.name ?? "No active org"}
                    <span>{formatPlanName(currentPlanId)} plan</span>
                  </strong>
                </div>

                {activeOrganization ? (
                  <>
                    <div className="usage-pricing-block">
                      <strong>Live usage from dashboard billing routes</strong>
                      <ul className="pricing-addon-list">
                        <li>
                          Seats: {formatWholeNumber(usageByKey.seats?.used)} used of{" "}
                          {typeof usageByKey.seats?.limit === "number" && usageByKey.seats.limit >= 0
                            ? formatWholeNumber(usageByKey.seats.limit)
                            : formatLimit(usageByKey.seats?.limit)}
                        </li>
                        <li>
                          Projects: {formatWholeNumber(usageByKey.projects?.used)} used of{" "}
                          {typeof usageByKey.projects?.limit === "number" &&
                          usageByKey.projects.limit >= 0
                            ? formatWholeNumber(usageByKey.projects.limit)
                            : formatLimit(usageByKey.projects?.limit)}
                        </li>
                        <li>
                          Local demo tokens this month:{" "}
                          {formatWholeNumber(usageByKey.tokensMonthly?.used)} used of{" "}
                          {typeof usageByKey.tokensMonthly?.limit === "number" &&
                          usageByKey.tokensMonthly.limit >= 0
                            ? formatWholeNumber(usageByKey.tokensMonthly.limit)
                            : formatLimit(usageByKey.tokensMonthly?.limit)}
                        </li>
                      </ul>
                    </div>

                    <div className="usage-pricing-block">
                      <strong>Current monthly pricing context</strong>
                      <ul className="pricing-addon-list">
                        <li>
                          Base subscription:{" "}
                          {currentMonthlyPricingProduct
                            ? `${formatMoney(
                                currentMonthlyPricingProduct.unitAmount,
                                currentMonthlyPricingProduct.currency ?? "usd",
                              )} / month`
                            : "Free"}
                        </li>
                        {currentPlanHighlights.map((line) => (
                          <li key={`current-highlight:${line}`}>{line}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="usage-pricing-block">
                      <strong>Stripe metered usage this billing period</strong>
                      <ul className="pricing-addon-list">
                        <li>
                          Tokens:{" "}
                          {meterUsageByKey.tokensMonthly
                            ? `${formatWholeNumber(
                                meterUsageByKey.tokensMonthly.currentPeriodUsed,
                              )} • ${formatMeterState(meterUsageByKey.tokensMonthly.state)}`
                            : "Not attached or not yet available"}
                        </li>
                        <li>
                          API calls:{" "}
                          {meterUsageByKey.apiCalls
                            ? `${formatWholeNumber(
                                meterUsageByKey.apiCalls.currentPeriodUsed,
                              )} • ${formatMeterState(meterUsageByKey.apiCalls.state)}`
                            : "Not attached or not yet available"}
                        </li>
                        {meterUsageByKey.tokensMonthly?.warning ? (
                          <li>{meterUsageByKey.tokensMonthly.warning}</li>
                        ) : null}
                        {meterUsageByKey.apiCalls?.warning &&
                        meterUsageByKey.apiCalls.warning !== meterUsageByKey.tokensMonthly?.warning ? (
                          <li>{meterUsageByKey.apiCalls.warning}</li>
                        ) : null}
                      </ul>
                    </div>

                    <div className="usage-pricing-block">
                      <strong>How metered billing works on this org</strong>
                      <ul className="pricing-addon-list">
                        <li>
                          Tokens included before overage:{" "}
                          {formatWholeNumber(currentTokenMeterUsage?.includedLimit)}
                        </li>
                        <li>
                          Tokens billable as overage right now:{" "}
                          {formatWholeNumber(currentTokenBillableOverage)}
                        </li>
                        <li>
                          Tokens remaining before the demo hard cap:{" "}
                          {formatWholeNumber(currentTokenMeterUsage?.remainingHard)}
                        </li>
                        <li>
                          Token pricing rule:{" "}
                          {currentTokenMeterPrice?.summary ??
                            "No Stripe token meter price is attached to the current monthly product."}
                        </li>
                        <li>{describeMeterBillingState(currentTokenMeterUsage, "tokensMonthly")}</li>
                        <li>
                          API calls included before overage:{" "}
                          {formatWholeNumber(currentApiMeterUsage?.includedLimit)}
                        </li>
                        <li>
                          API calls billable as overage right now:{" "}
                          {formatWholeNumber(currentApiBillableOverage)}
                        </li>
                        <li>
                          API calls remaining before the demo hard cap:{" "}
                          {formatWholeNumber(currentApiMeterUsage?.remainingHard)}
                        </li>
                        <li>
                          API pricing rule:{" "}
                          {currentApiMeterPrice?.summary ??
                            "No Stripe API-call meter price is attached to the current monthly product."}
                        </li>
                        <li>{describeMeterBillingState(currentApiMeterUsage, "apiCalls")}</li>
                      </ul>
                    </div>

                    {currentAdditionalPricing.length > 0 ? (
                      <div className="usage-pricing-block">
                        <strong>Additional pricing</strong>
                        <ul className="pricing-addon-list">
                          {currentAdditionalPricing.map((line) => (
                            <li key={`current-pricing:${line}`}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="pricing-seat-note">
                        This organization is on the free plan right now, so monthly overage
                        pricing appears once a paid subscription is attached.
                      </p>
                    )}

                    <p className="pricing-seat-note">
                      Seats, projects, and monthly tokens above come from the same billing usage
                      routes this dashboard already uses. Metered API calls are configured for
                      Stripe reporting, but this demo does not keep a separate live local counter
                      for them yet.
                    </p>
                  </>
                ) : (
                  <p className="pricing-seat-note">
                    Activate an organization to see live consumption and the current plan’s pricing
                    context here.
                  </p>
                )}
              </article>

              {usagePricingReferenceProducts.map((product) => {
                const highlights =
                  monthlyPlanHighlights[product.planId as keyof typeof monthlyPlanHighlights] ??
                  [];
                const additionalPricing = [
                  ...(product.seatUnitAmount != null
                    ? [
                        `Extra seats: ${formatMoney(
                          product.seatUnitAmount,
                          product.seatCurrency ?? "usd",
                        )} / seat / month`,
                      ]
                    : []),
                  ...product.meterPrices.map(
                    (meterPrice) =>
                      `${formatMeterLabel(meterPrice.key)}: ${
                        meterPrice.summary ?? "Additional usage pricing"
                      }`,
                  ),
                ];

                return (
                  <article className="usage-pricing-card" key={`usage-pricing:${product.id}`}>
                    <div className="pricing-plan-topline">
                      <span className={`pricing-plan-badge pricing-plan-badge-${product.planId}`}>
                        {formatPlanName(product.planId ?? "plan")}
                      </span>
                      <strong className="usage-pricing-price">
                        {formatMoney(product.unitAmount, product.currency ?? "usd")}
                        <span>/month</span>
                      </strong>
                    </div>

                    <div className="usage-pricing-block">
                      <strong>Included each month</strong>
                      <ul className="pricing-addon-list">
                        {highlights.map((line) => (
                          <li key={`${product.id}:highlight:${line}`}>{line}</li>
                        ))}
                      </ul>
                    </div>

                    {additionalPricing.length > 0 ? (
                      <div className="usage-pricing-block">
                        <strong>Additional pricing</strong>
                        <ul className="pricing-addon-list">
                          {additionalPricing.map((line) => (
                            <li key={`${product.id}:pricing:${line}`}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="card">
          <h2>Current Org Members</h2>
          {!activeOrganization ? (
            <p>No active organization selected.</p>
          ) : activeOrganization.members.length === 0 ? (
            <p>No members found yet.</p>
          ) : (
            <div className="session-stack">
              {activeOrganization.members.map((member) => (
                <div className="session-line" key={member.id}>
                  <div className="line-copy">
                    <strong>{member.user?.name ?? member.userId}</strong>
                    <span>{member.user?.email ?? member.userId}</span>
                  </div>
                  <span>{member.role}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
