"use client";

import { useEffect, useState } from "react";
import type {
  StripeCatalogMeterPrice,
  StripeBillingSeatLimitSource,
  StripeBillingStatusResult,
  StripeCatalogProduct,
} from "@farm.js/stripe/client";
import { apiClient } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { authOrganizationClient } from "../lib/auth-organization-client";
import { exampleMeta } from "../lib/example-meta";

type BillingCycle = "month" | "year";
type CheckoutIntent = "trial" | "subscribe";
type ProductState =
  | { status: "loading"; products: StripeCatalogProduct[]; message?: string }
  | { status: "ready"; products: StripeCatalogProduct[]; message?: string }
  | { status: "error"; products: StripeCatalogProduct[]; message: string };

const pricingPlans = [
  {
    id: "free",
    name: "Free",
    badge: "Sandbox",
    description:
      "For prototypes and internal pilots.",
    monthlyLabel: "$0",
    priceSuffix: "/forever",
    ctaLabel: "Start Free",
    includes: {
      seats: "4 seats",
      projects: "1 project",
      usage: "100k tokens + 5k API calls",
    },
    features: [
      "Organization workspace and teammate invites",
      "Project creation and local auth flows",
      "Upgrade from the same billing owner later",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    badge: "Most Popular",
    description:
      "For shipping product and AI teams.",
    ctaLabel: "Upgrade to Pro",
    includes: {
      seats: "5 included seats",
      projects: "10 projects",
      usage: "1M tokens + 50k API calls",
    },
    features: [
      "Analytics, billing portal, and org-owned billing",
      "Seat upgrades on the same active subscription",
      "Clear monthly overage pricing for usage growth",
    ],
  },
  {
    id: "business",
    name: "Business",
    badge: "Scale",
    description:
      "For larger organizations operating at scale.",
    ctaLabel: "Upgrade to Business",
    includes: {
      seats: "25 included seats",
      projects: "Unlimited projects",
      usage: "10M tokens + 500k API calls",
    },
    features: [
      "SSO, priority support, and higher included capacity",
      "Lower monthly overage pricing on usage-heavy workloads",
      "Built for bigger teams sharing one billing owner",
    ],
  },
] as const;

function formatAmount(unitAmount: number | null) {
  if (typeof unitAmount !== "number") {
    return "Custom";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: unitAmount % 100 === 0 ? 0 : 2,
  }).format(unitAmount / 100);
}

function formatCycleLabel(cycle: BillingCycle) {
  return cycle === "month" ? "Monthly" : "Yearly";
}

function formatPlanName(planId: string) {
  return planId.charAt(0).toUpperCase() + planId.slice(1);
}

function formatSeatLimitSource(source: StripeBillingSeatLimitSource | null | undefined) {
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

function formatDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleDateString();
}

function calculateDiscountPercent(unitAmount: number, compareAtAmount: number) {
  if (compareAtAmount <= unitAmount) {
    return 0;
  }

  return Math.round(((compareAtAmount - unitAmount) / compareAtAmount) * 100);
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

function getPlanProduct(
  products: StripeCatalogProduct[],
  planId: string,
  cycle: BillingCycle,
) {
  return products.find(
    (product) =>
      product.planId === planId &&
      product.kind === "subscription" &&
      product.interval === cycle,
  );
}

function getYearlyPlanDiscount(
  products: StripeCatalogProduct[],
  planId: string,
  cycle: BillingCycle,
) {
  if (cycle !== "year") {
    return null;
  }

  const yearlyProduct = getPlanProduct(products, planId, "year");
  const monthlyProduct = getPlanProduct(products, planId, "month");

  if (
    typeof yearlyProduct?.unitAmount !== "number" ||
    typeof monthlyProduct?.unitAmount !== "number"
  ) {
    return null;
  }

  const compareAtAmount = monthlyProduct.unitAmount * 12;
  if (compareAtAmount <= yearlyProduct.unitAmount) {
    return null;
  }

  return {
    compareAtAmount,
    savingsAmount: compareAtAmount - yearlyProduct.unitAmount,
    discountPercent: calculateDiscountPercent(
      yearlyProduct.unitAmount,
      compareAtAmount,
    ),
  };
}

export function HomeClient() {
  const [customerEmail, setCustomerEmail] = useState("");
  const [activeOrganizationName, setActiveOrganizationName] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("month");
  const [pendingCheckoutKey, setPendingCheckoutKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [billingStatus, setBillingStatus] = useState<StripeBillingStatusResult | null>(null);
  const [products, setProducts] = useState<ProductState>({
    status: "loading",
    products: [],
  });
  const signedIn = customerEmail.length > 0;
  const currentPlanId = signedIn ? billingStatus?.planId ?? "free" : null;
  const currentProductId = billingStatus?.productId ?? null;

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }

    const storedTheme = window.localStorage.getItem("farm-pricing-theme");
    if (storedTheme === "light" || storedTheme === "dark") {
      document.documentElement.dataset.theme = storedTheme;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadProducts() {
      const result = await apiClient.billing.products();
      if (cancelled) {
        return;
      }

      if (result.error) {
        setProducts({
          status: "error",
          products: [],
          message: result.error.message,
        });
        return;
      }

      setProducts({
        status: "ready",
        products: result.data || [],
      });
    }

    void loadProducts();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadBillingContext() {
      const statusResult = await apiClient.billing.status();

      if (cancelled) {
        return;
      }

      if (!statusResult.error) {
        setBillingStatus(statusResult.data ?? null);
      }
    }

    authClient.getSession().then(async (response) => {
      if (cancelled) {
        return;
      }

      const authenticatedEmail = response.data?.user?.email?.trim();
      if (!authenticatedEmail) {
        setCustomerEmail("");
        setActiveOrganizationName(null);
        setBillingStatus(null);
        return;
      }

      setCustomerEmail(authenticatedEmail);

      const activeOrgResult = await authOrganizationClient.getFullOrganization();
      if (cancelled) {
        return;
      }

      if (activeOrgResult.data?.name) {
        setActiveOrganizationName(activeOrgResult.data.name);
        await loadBillingContext();
      } else {
        setActiveOrganizationName(null);
        setBillingStatus(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshBillingStatus() {
    const statusResult = await apiClient.billing.status();

    if (!statusResult.error) {
      setBillingStatus(statusResult.data ?? null);
    }
  }

  async function handleCheckout(productId: string, intent: CheckoutIntent) {
    if (!activeOrganizationName) {
      setFeedback("Create or activate an organization from the dashboard before starting checkout.");
      return;
    }

    const checkoutKey = `${productId}:${intent}`;
    setPendingCheckoutKey(checkoutKey);
    setFeedback(null);

    const result = await apiClient.billing.checkout({
      body: {
        productId,
        customerEmail: customerEmail.trim() || undefined,
        successPath: "/success",
        cancelPath: "/cancel",
        trialBehavior: intent === "trial" ? "require" : "none",
      },
    });

    if (result.error) {
      setFeedback(result.error.message);
      setPendingCheckoutKey(null);
      return;
    }

    if (intent === "trial" && !result.data?.trialApplied) {
      setFeedback("This organization is not eligible for a free trial anymore. Use Subscribe now instead.");
      setPendingCheckoutKey(null);
      await refreshBillingStatus();
      return;
    }

    if (result.data?.redirectTo) {
      window.location.assign(result.data.redirectTo);
      return;
    }

    setPendingCheckoutKey(null);
  }
  return (
    <main className="page-shell page-shell-wide">
      <section className="hero">
        <span className="eyebrow">{exampleMeta.target} Example</span>
        <h1>{exampleMeta.title}</h1>
        <p>
          Organization billing that feels like a real product: clear plans, predictable monthly
          allowances, and direct checkout for the active workspace below.
        </p>
      </section>

      <section className="playground-grid">
        <section className="card">
          <h2>Org Billing Setup</h2>
          <div className="link-grid">
            <a className="nav-card" href="/sign-in">
              <strong>Sign In</strong>
              <span>Use Better Auth to load the current session and active organization.</span>
            </a>
            <a className="nav-card" href="/sign-up">
              <strong>Sign Up</strong>
              <span>Create a local user, then create or join an organization.</span>
            </a>
            <a className="nav-card" href="/dashboard">
              <strong>Org Dashboard</strong>
              <span>Create orgs, invite members, and inspect usage-backed billing limits.</span>
            </a>
          </div>

          <div className="mode-box">
            <strong>Generation target: {exampleMeta.target}</strong>
            <p>{exampleMeta.details}</p>
            <pre className="response-pre">{exampleMeta.generateCommand}</pre>
          </div>

          <div className="mode-box">
            {signedIn ? (
              <>
                <strong>Signed in as {customerEmail}</strong>
                <p>
                  {activeOrganizationName
                    ? `Active billing owner: ${activeOrganizationName}`
                    : "Create or activate an organization on the dashboard before starting checkout."}
                </p>
              </>
            ) : (
              <>
                <strong>Sign in first</strong>
                <p>After sign in, switch to an active organization and the pricing cards will bill that org.</p>
              </>
            )}
          </div>
        </section>

        <section className="card pricing-card-shell">
          <div className="pricing-header">
            <div className="pricing-heading">
              <h2>Pricing</h2>
              <p>
                Choose a plan for the active organization. Monthly plans show included usage,
                additional seat pricing, and overage details right on the card.
              </p>
            </div>

            <div className="billing-toggle" aria-label="Billing cycle">
              {(["month", "year"] as const).map((cycle) => (
                <button
                  key={cycle}
                  className={`toggle-button${billingCycle === cycle ? " is-active" : ""}`}
                  type="button"
                  onClick={() => setBillingCycle(cycle)}
                >
                  {formatCycleLabel(cycle)}
                </button>
              ))}
            </div>
          </div>

          {signedIn && activeOrganizationName ? (
            <div className="notice notice-success">
              Billing owner: <strong>{activeOrganizationName}</strong>
              {currentPlanId ? ` • Current plan: ${formatPlanName(currentPlanId)}` : ""}
              {billingStatus?.seatMode ? ` • Seats: ${formatSeatLimitSource(billingStatus.seatLimitSource)}` : ""}
              {billingStatus?.status === "trialing" && billingStatus.trialEndsAt
                ? ` • Trial ends ${formatDate(billingStatus.trialEndsAt)}`
                : ""}
            </div>
          ) : null}

          <div className="pricing-grid">
            {pricingPlans.map((plan) => {
              const product = getPlanProduct(products.products, plan.id, billingCycle);
              const yearlyDiscount = getYearlyPlanDiscount(
                products.products,
                plan.id,
                billingCycle,
              );
              const isCurrentPlan = currentPlanId === plan.id;
              const isCurrentProduct = currentProductId === product?.id;
              const canCheckout = plan.id === "free" ? false : Boolean(product);
              const canStartTrial =
                Boolean(product?.trialDays) &&
                currentPlanId === "free" &&
                !billingStatus?.trialUsedAt &&
                billingStatus?.status !== "trialing";
              const trialButtonKey = product ? `${product.id}:trial` : null;
              const subscribeButtonKey = product ? `${product.id}:subscribe` : null;
              const additionalPricing =
                billingCycle === "month"
                  ? [
                      ...(product?.seatUnitAmount != null
                        ? [`Extra seats: ${formatAmount(product.seatUnitAmount)} / seat / month`]
                        : []),
                      ...((product?.meterPrices ?? []).map(
                        (meterPrice: StripeCatalogMeterPrice) =>
                          `${formatMeterLabel(meterPrice.key)}: ${meterPrice.summary ?? "Additional usage pricing"}`,
                      )),
                    ]
                  : [];

              return (
                <article
                  className={`pricing-plan-card pricing-plan-card-${plan.id}${plan.id === "pro" ? " pricing-plan-card-featured" : ""}${isCurrentPlan ? " is-active-plan" : ""}`}
                  key={plan.id}
                >
                  <div className="pricing-plan-topline">
                    <span className={`pricing-plan-badge pricing-plan-badge-${plan.id}`}>
                      {plan.badge}
                    </span>
                    {isCurrentPlan ? (
                      <span className="pricing-current-pill">Current plan</span>
                    ) : null}
                  </div>

                  <div className="pricing-plan-header">
                    <div className="pricing-plan-copy">
                      <h3>{plan.name}</h3>
                      <p className="pricing-plan-summary">{plan.description}</p>
                    </div>
                    <div className="pricing-plan-price">
                      <strong>
                        {plan.id === "free"
                          ? plan.monthlyLabel
                          : product
                            ? formatAmount(product.unitAmount ?? null)
                            : products.status === "loading"
                              ? "Loading..."
                              : "Unavailable"}
                      </strong>
                      <span>
                        {plan.id === "free"
                          ? plan.priceSuffix
                          : `/${billingCycle === "month" ? "month" : "year"}`}
                      </span>
                      {yearlyDiscount ? (
                        <div className="pricing-discount-meta">
                          <span className="pricing-discount-badge">
                            Save {yearlyDiscount.discountPercent}%
                          </span>
                          <span className="pricing-compare-at">
                            vs {formatAmount(yearlyDiscount.compareAtAmount)}/year
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="pricing-list-section">
                    <p className="pricing-section-label">Included</p>
                    <ul className="pricing-feature-list pricing-feature-list-compact">
                      <li>{plan.includes.seats}</li>
                      <li>{plan.includes.projects}</li>
                      <li>{plan.includes.usage}</li>
                      {plan.features.map((feature) => (
                        <li key={feature}>{feature}</li>
                      ))}
                    </ul>
                  </div>
                  {product?.trialDays ? (
                    <p className="pricing-trial-note">
                      Includes a {product.trialDays}-day free trial for first-time billing owners.
                    </p>
                  ) : null}
                  {additionalPricing.length > 0 ? (
                    <div className="pricing-list-section pricing-addon-section">
                      <p className="pricing-addon-heading">Additional pricing</p>
                      <ul className="pricing-addon-list pricing-addon-list-compact">
                        {additionalPricing.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {billingCycle === "year" && plan.id !== "free" ? (
                    <p className="pricing-seat-note">
                      In this demo, Stripe metered token and API-call overage is attached on the
                      monthly Pro and Business products. Yearly plans still show the fixed plan
                      price and seat add-ons.
                    </p>
                  ) : null}

                  {plan.id === "free" ? (
                    <a className="secondary-link" href="/dashboard">
                      Manage Organizations
                    </a>
                  ) : (
                    <>
                      {yearlyDiscount ? (
                        <p className="pricing-savings-note">
                          Save {formatAmount(yearlyDiscount.savingsAmount)} per year
                          compared with paying monthly for 12 months.
                        </p>
                      ) : null}
                      <div className="pricing-action-row">
                        {canStartTrial ? (
                          <button
                            className="primary-button"
                            disabled={!canCheckout || pendingCheckoutKey === trialButtonKey}
                            onClick={() => product && void handleCheckout(product.id, "trial")}
                            type="button"
                          >
                            {trialButtonKey && pendingCheckoutKey === trialButtonKey
                              ? "Starting Trial..."
                              : `Start ${product?.trialDays}-Day Trial`}
                          </button>
                        ) : null}
                        <button
                          className={canStartTrial ? "secondary-button" : "primary-button"}
                          disabled={!canCheckout || isCurrentProduct || pendingCheckoutKey === subscribeButtonKey}
                          onClick={() => product && void handleCheckout(product.id, "subscribe")}
                          type="button"
                        >
                          {subscribeButtonKey && pendingCheckoutKey === subscribeButtonKey
                            ? "Opening Checkout..."
                            : isCurrentProduct
                              ? "Current Subscription"
                              : canStartTrial
                                ? "Subscribe Now"
                                : plan.ctaLabel}
                        </button>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </div>

          <div className="pricing-footnote">
            <strong>How pricing works in practice</strong>
            <p>
              Included seats and usage reset each billing period. Additional seats and usage
              overages only apply after the active organization has consumed the included monthly
              allowance on its current plan. In this demo, that metered overage path is attached
              to the monthly paid plans.
            </p>
          </div>

          {feedback ? <div className="notice notice-error">{feedback}</div> : null}
          {products.status === "error" ? (
            <div className="notice notice-error">{products.message}</div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
