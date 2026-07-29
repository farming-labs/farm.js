"use client";

import { useEffect, useState } from "react";
import type {
  PolarBillingStatusResult,
  PolarCatalogMeterPrice,
  PolarCatalogProduct,
} from "@farm.js/polar/client";
import { apiClient } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { authOrganizationClient } from "../lib/auth-organization-client";

type BillingCycle = "month" | "year";
type ProductState =
  | { status: "loading"; products: PolarCatalogProduct[]; message?: string }
  | { status: "ready"; products: PolarCatalogProduct[]; message?: string }
  | { status: "error"; products: PolarCatalogProduct[]; message: string };

const pricingPlans = [
  {
    id: "free",
    name: "Free",
    badge: "Sandbox",
    description: "For prototypes and internal pilots.",
    monthlyLabel: "$0",
    yearlyLabel: "$0",
    priceSuffix: "/forever",
    ctaLabel: "Manage Organizations",
    unavailableNote: null,
    includes: {
      seats: "4 teammates",
      projects: "1 internal workspace",
      usage: "100k included tokens",
    },
    features: [
      "Organization workspace and active-owner switching",
      "Local sign-in, sign-up, and organization testing",
      "Upgrade the same organization later",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    badge: "Most Popular",
    description: "For shipping product and AI teams.",
    monthlyLabel: "$20",
    yearlyLabel: "$200",
    ctaLabel: "Upgrade to Pro",
    includes: {
      seats: "5 teammates",
      projects: "10 active workspaces",
      usage: "1M included tokens",
    },
    features: [
      "Recurring Polar subscription for the active organization",
      "Metered token usage reported directly from the dashboard",
      "Customer portal access for billing and payment methods",
    ],
    unavailableNote:
      "Add POLAR_PRO_MONTHLY_PRODUCT_ID or POLAR_PRO_YEARLY_PRODUCT_ID in .env.local to enable live Polar checkout for this plan.",
  },
  {
    id: "business",
    name: "Business",
    badge: "Scale",
    description: "For larger organizations operating at scale.",
    monthlyLabel: "$49",
    yearlyLabel: "$490",
    ctaLabel: "Upgrade to Business",
    includes: {
      seats: "25 teammates",
      projects: "Unlimited workspaces",
      usage: "10M included tokens",
    },
    features: [
      "Higher included usage before overage matters",
      "Designed for teams with central billing ownership",
      "Priority support and SSO-oriented packaging",
    ],
    unavailableNote:
      "Set POLAR_BUSINESS_MONTHLY_PRODUCT_ID and POLAR_BUSINESS_YEARLY_PRODUCT_ID to turn on live Business checkout in this demo.",
  },
] as const;

function formatAmount(unitAmount: number | null, currency = "usd") {
  if (typeof unitAmount !== "number") {
    return "Unavailable";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: unitAmount % 100 === 0 ? 0 : 2,
  }).format(unitAmount / 100);
}

function formatCycleLabel(cycle: BillingCycle) {
  return cycle === "month" ? "Monthly" : "Yearly";
}

function formatPlanName(planId: string) {
  return planId.charAt(0).toUpperCase() + planId.slice(1);
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
    default:
      return key;
  }
}

function getPlanProduct(
  products: PolarCatalogProduct[],
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

function getTokenPackProduct(products: PolarCatalogProduct[]) {
  return products.find((product) => product.id === "tokenPack" || product.kind === "one_time");
}

function getPlanFallbackAmount(
  plan: (typeof pricingPlans)[number],
  cycle: BillingCycle,
) {
  return cycle === "year" ? plan.yearlyLabel : plan.monthlyLabel;
}

function getYearlyPlanDiscount(
  products: PolarCatalogProduct[],
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

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed for ${path}`);
  }

  return (await response.json()) as T;
}

export interface HomeClientProps {
  initialProducts?: PolarCatalogProduct[];
}

export function HomeClient({ initialProducts = [] }: HomeClientProps) {
  const [customerEmail, setCustomerEmail] = useState("");
  const [activeOrganizationName, setActiveOrganizationName] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("month");
  const [pendingCheckoutKey, setPendingCheckoutKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [billingStatus, setBillingStatus] = useState<PolarBillingStatusResult | null>(null);
  const [products, setProducts] = useState<ProductState>({
    status: "ready",
    products: initialProducts,
  });

  const signedIn = customerEmail.length > 0;
  const currentPlanId = signedIn ? billingStatus?.planId ?? "free" : null;
  const currentProductId = billingStatus?.productId ?? null;
  const tokenPackProduct = getTokenPackProduct(products.products);

  useEffect(() => {
    let cancelled = false;

    async function loadProducts() {
      try {
        const catalog = await fetchJson<PolarCatalogProduct[]>("/billing/products");
        if (cancelled) {
          return;
        }

        setProducts({
          status: "ready",
          products: catalog,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setProducts({
          status: "error",
          products: initialProducts,
          message:
            error instanceof Error ? error.message : "Could not load the Polar product catalog.",
        });
      }
    }

    void loadProducts();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadBillingContext() {
      try {
        const status = await fetchJson<PolarBillingStatusResult>("/billing/status");
        if (!cancelled) {
          setBillingStatus(status);
        }
      } catch {
        if (!cancelled) {
          setBillingStatus(null);
        }
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
    try {
      const status = await fetchJson<PolarBillingStatusResult>("/billing/status");
      setBillingStatus(status);
    } catch {
      setBillingStatus(null);
    }
  }

  async function handleCheckout(productId: string) {
    if (!customerEmail.trim()) {
      setFeedback("Sign in first, then choose an active organization before starting checkout.");
      return;
    }

    if (!activeOrganizationName) {
      setFeedback("Create or activate an organization from the dashboard before starting checkout.");
      return;
    }

    setPendingCheckoutKey(productId);
    setFeedback(null);

    const result = await apiClient.billing.checkout({
      body: {
        productId,
        customerEmail: customerEmail.trim() || undefined,
        successPath: "/success",
        cancelPath: "/cancel",
      },
    });

    if (result.error) {
      setFeedback(result.error.message);
      setPendingCheckoutKey(null);
      return;
    }

    if (result.data?.redirectTo) {
      window.location.assign(result.data.redirectTo);
      return;
    }

    setPendingCheckoutKey(null);
    await refreshBillingStatus();
  }

  return (
    <main className="page-shell page-shell-wide">
      <section className="hero">
        <span className="eyebrow">Polar + Better Auth</span>
        <h1>Production-style pricing for Free, Pro, and Business plans.</h1>
        <p>
          Choose a plan for the active organization, see how recurring pricing and token metering
          fit together, and test the same Better Auth billing flow you use from the dashboard.
        </p>
      </section>

      <section className="card page-notice">
        <h2>Organization billing setup</h2>
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
            <span>Switch owners, report usage, and inspect Polar customer state.</span>
          </a>
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

        {billingStatus ? (
          <div className="mode-box">
            <strong>Current billing state</strong>
            <p>
              Plan: {formatPlanName(billingStatus.planId)} • Status: {billingStatus.status}
              {billingStatus.currentPeriodEnd
                ? ` • Current period ends ${new Date(billingStatus.currentPeriodEnd).toLocaleDateString()}`
                : ""}
            </p>
          </div>
        ) : null}
      </section>

      <section className="card pricing-card-shell">
          <div className="pricing-header">
            <div className="pricing-heading">
              <h2>Pricing</h2>
              <p>
                This page follows the Stripe example layout: clear plan cards first, live checkout
                when a Polar product is configured, and metered token pricing called out separately.
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
              {billingStatus?.customerId ? " • Polar customer ready" : " • No Polar customer yet"}
            </div>
          ) : null}

          <div className="pricing-grid pricing-grid-polar">
            {pricingPlans.map((plan) => {
              const product =
                plan.id === "free"
                  ? null
                  : getPlanProduct(products.products, plan.id, billingCycle);
              const yearlyDiscount = getYearlyPlanDiscount(
                products.products,
                plan.id,
                billingCycle,
              );
              const isCurrentPlan = currentPlanId === plan.id;
              const isCurrentProduct = currentProductId === product?.id;
              const additionalPricing =
                billingCycle === "month"
                  ? (product?.meterPrices ?? []).map(
                      (meterPrice: PolarCatalogMeterPrice) =>
                        `${formatMeterLabel(meterPrice.key)}: ${meterPrice.summary ?? "Additional usage pricing"}`,
                    )
                  : [];
              const fallbackAmount = getPlanFallbackAmount(plan, billingCycle);
              const missingConfiguredProduct = plan.id !== "free" && !product;

              return (
                <article
                  className={`pricing-plan-card${plan.id === "pro" ? " pricing-plan-card-featured" : ""}${isCurrentPlan ? " is-active-plan" : ""}`}
                  key={plan.id}
                >
                  <div className="pricing-plan-topline">
                    <span className={`pricing-plan-badge pricing-plan-badge-${plan.id}`}>
                      {plan.badge}
                    </span>
                    {isCurrentPlan ? <span className="pricing-current-pill">Current plan</span> : null}
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
                            ? formatAmount(product.unitAmount, product.currency ?? "usd")
                            : fallbackAmount}
                      </strong>
                      <span>
                        {plan.id === "free"
                          ? plan.priceSuffix
                          : `/${billingCycle === "month" ? "month" : "year"}`}
                      </span>
                      {missingConfiguredProduct ? (
                        <span className="pricing-preview-label">Preview pricing</span>
                      ) : null}
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
                      Includes a {product.trialDays}-day free trial for new billing owners.
                    </p>
                  ) : null}

                  {additionalPricing.length > 0 ? (
                    <div className="pricing-list-section pricing-addon-section">
                      <p className="pricing-addon-heading">Additional pricing</p>
                      <ul className="pricing-addon-list pricing-addon-list-compact">
                        {additionalPricing.map((line: string) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ) : plan.id !== "free" && billingCycle === "month" ? (
                    <div className="pricing-list-section pricing-addon-section">
                      <p className="pricing-addon-heading">Additional pricing</p>
                      {missingConfiguredProduct ? (
                        <p className="pricing-note">{plan.unavailableNote}</p>
                      ) : (
                        <p className="pricing-note">
                          No live metered price is attached to this product yet. Polar checkout can
                          still work, but metered usage will not affect billing until the product has
                          a metered price connected to the same meter id the app reports to.
                        </p>
                      )}
                    </div>
                  ) : null}

                  {plan.id === "free" ? (
                    <a className="secondary-link" href="/dashboard">
                      {plan.ctaLabel}
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
                        <button
                          className="primary-button"
                          disabled={!product || isCurrentProduct || pendingCheckoutKey === product?.id}
                          onClick={() => product && void handleCheckout(product.id)}
                          type="button"
                        >
                          {pendingCheckoutKey === product?.id
                            ? "Opening Checkout..."
                            : isCurrentProduct
                              ? "Current Subscription"
                              : missingConfiguredProduct
                                ? "Checkout Unavailable"
                                : plan.ctaLabel}
                        </button>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </div>

          <div className="utility-grid">
            <article className="product-card utility-card">
              <div className="product-copy">
                <span className="status-pill">Usage</span>
                <h3>How metered billing works here</h3>
                <p>
                  The subscription amount stays fixed, while token usage is measured through the
                  Polar meter and billed from the live metered price attached to the selected
                  monthly or yearly subscription product.
                </p>
              </div>
              <div className="pricing-meta-list">
                <div className="pricing-meta-row">
                  <strong>Monthly Pro meter rate</strong>
                  <span>
                    {getPlanProduct(products.products, "pro", "month")?.meterPrices[0]?.summary ??
                      "No metered price attached yet"}
                  </span>
                </div>
                <div className="pricing-meta-row">
                  <strong>Monthly Business meter rate</strong>
                  <span>
                    {getPlanProduct(products.products, "business", "month")?.meterPrices[0]?.summary ??
                      "No metered price attached yet"}
                  </span>
                </div>
                <div className="pricing-meta-row">
                  <strong>App-side Pro hard stop</strong>
                  <span>3,000,000 total tokens</span>
                </div>
              </div>
            </article>

            {tokenPackProduct ? (
              <article className="product-card utility-card">
                <div className="product-copy">
                  <span className="status-pill">One-Time</span>
                  <h3>{tokenPackProduct.name}</h3>
                  <p>
                    A separate Polar purchase for prepaid usage packs or credits. Use it when you
                    want to test a standalone payment alongside the recurring subscription flow.
                  </p>
                </div>
                <div className="product-footer">
                  <div className="product-price">
                    {formatAmount(tokenPackProduct.unitAmount, tokenPackProduct.currency ?? "usd")}
                  </div>
                  <button
                    className="ghost-button"
                    disabled={pendingCheckoutKey === tokenPackProduct.id}
                    onClick={() => void handleCheckout(tokenPackProduct.id)}
                    type="button"
                  >
                    {pendingCheckoutKey === tokenPackProduct.id ? "Opening Checkout..." : "Buy Token Pack"}
                  </button>
                </div>
              </article>
            ) : null}
          </div>

          <div className="pricing-footnote">
            <strong>How pricing works in practice</strong>
            <p>
              Included usage is an app-side allowance from the active plan, while Polar metered
              pricing comes from the live product configuration. To see usage affect the bill, the
              live Polar subscription product must have a metered price attached to the same meter
              id the app reports to.
            </p>
          </div>

          {feedback ? <div className="notice notice-error">{feedback}</div> : null}
          {products.status === "error" ? (
            <div className="notice notice-error">{products.message}</div>
          ) : null}
      </section>
    </main>
  );
}
