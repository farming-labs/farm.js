"use client";

import { useEffect, useState } from "react";
import type {
  StripeBillingStatusResult,
  StripeCatalogProduct,
} from "@farmjs/integrations/stripe/client";
import { apiClient } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { exampleMeta } from "../lib/example-meta";

type BillingCycle = "month" | "year";
type ProductState =
  | { status: "loading"; products: StripeCatalogProduct[]; message?: string }
  | { status: "ready"; products: StripeCatalogProduct[]; message?: string }
  | { status: "error"; products: StripeCatalogProduct[]; message: string };

const pricingPlans = [
  {
    id: "free",
    name: "Free",
    description: "A clean starting point for local testing and smaller projects.",
    monthlyLabel: "$0",
    priceSuffix: "/forever",
    ctaLabel: "Get Started",
    features: [
      "1 seat included",
      "1 active project",
      "Starter billing routes",
      "Basic auth + dashboard flow",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    description: "More seats, analytics, and the billing portal for growing teams.",
    ctaLabel: "Choose Pro",
    features: [
      "5 seats included",
      "10 active projects",
      "Analytics enabled",
      "Billing portal access",
    ],
  },
  {
    id: "business",
    name: "Business",
    description: "Advanced collaboration with SSO and priority support built in.",
    ctaLabel: "Choose Business",
    features: [
      "25 seats included",
      "Unlimited projects",
      "Priority support",
      "SSO enabled",
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

export function HomeClient() {
  const [customerEmail, setCustomerEmail] = useState("");
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("month");
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [billingStatus, setBillingStatus] = useState<StripeBillingStatusResult | null>(null);
  const [products, setProducts] = useState<ProductState>({
    status: "loading",
    products: [],
  });

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

    authClient.getSession().then(async (response) => {
      if (cancelled) {
        return;
      }

      const authenticatedEmail = response.data?.user?.email?.trim();
      if (!authenticatedEmail) {
        setCustomerEmail("");
        setBillingStatus(null);
        return;
      }

      setCustomerEmail(authenticatedEmail);

      const statusResult = await apiClient.billing.status();
      if (cancelled || statusResult.error) {
        return;
      }

      setBillingStatus(statusResult.data ?? null);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCheckout(productId: string) {
    setPendingProductId(productId);
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
      setPendingProductId(null);
      return;
    }

    if (result.data?.redirectTo) {
      window.location.assign(result.data.redirectTo);
      return;
    }

    setPendingProductId(null);
  }

  const signedIn = customerEmail.length > 0;
  const currentPlanId = signedIn ? billingStatus?.planId ?? "free" : null;
  const currentProductId = billingStatus?.productId ?? null;

  return (
    <main className="page-shell">
      <section className="hero">
        <span className="eyebrow">{exampleMeta.target} Example</span>
        <h1>{exampleMeta.title}</h1>
        <p>
          This example uses the existing Better Auth integration for auth routes,
          auto-migrates the Better Auth SQLite schema on startup, and uses the
          real Stripe SDK for hosted checkout routes.
        </p>
      </section>

      <section className="playground-grid">
        <section className="card">
          <h2>Auth + Generate</h2>
          <div className="link-grid">
            <a className="nav-card" href="/sign-in">
              <strong>Sign In</strong>
              <span>Use the Better Auth client to create a session.</span>
            </a>
            <a className="nav-card" href="/sign-up">
              <strong>Sign Up</strong>
              <span>Create a local user through Better Auth.</span>
            </a>
            <a className="nav-card" href="/dashboard">
              <strong>Dashboard</strong>
              <span>Verify the session is readable inside the app.</span>
            </a>
          </div>

          <div className="mode-box">
            <strong>Generation target: {exampleMeta.target}</strong>
            <p>{exampleMeta.details}</p>
            <pre className="response-pre">{exampleMeta.generateCommand}</pre>
          </div>
        </section>

        <section className="card pricing-card-shell">
          <div className="pricing-header">
            <div className="pricing-heading">
              <h2>Pricing</h2>
              <p>
                Standard SaaS plans wired to the Stripe billing products configured in this
                example.
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

          <div className="mode-box">
            {signedIn ? (
              <>
                <strong>Signed in as {customerEmail}</strong>
                <p>
                  Current plan: {formatPlanName(currentPlanId ?? "free")} (
                  {billingStatus?.status ?? "free"})
                </p>
              </>
            ) : (
              <>
                <strong>Sign in to start checkout</strong>
                <p>Checkout uses the Better Auth session to resolve the billing owner.</p>
              </>
            )}
          </div>

          {feedback ? <div className="notice notice-error">{feedback}</div> : null}
          {products.status === "loading" ? <p>Loading Stripe products...</p> : null}
          {products.status === "error" ? (
            <div className="notice notice-error">{products.message}</div>
          ) : null}

          <div className="pricing-grid">
            {pricingPlans.map((plan) => {
              const product =
                plan.id === "free"
                  ? null
                  : getPlanProduct(products.products, plan.id, billingCycle);
              const isCurrentPlan = currentPlanId === plan.id;
              const isCurrentProduct = product ? currentProductId === product.id : isCurrentPlan;
              const isPending = product ? pendingProductId === product.id : false;
              const amountLabel =
                plan.id === "free"
                  ? plan.monthlyLabel
                  : formatAmount(product?.unitAmount ?? null);
              const suffix =
                plan.id === "free"
                  ? plan.priceSuffix
                  : billingCycle === "month"
                    ? "/month"
                    : "/year";

              return (
                <article
                  className={`pricing-plan-card${
                    plan.id === "pro" ? " pricing-plan-card-featured" : ""
                  }${isCurrentPlan ? " pricing-plan-card-current" : ""}`}
                  key={plan.id}
                >
                  <div className="plan-header">
                    <div>
                      <div className="plan-name-row">
                        <h3>{plan.name}</h3>
                        {isCurrentPlan ? <span className="status-pill">Current Plan</span> : null}
                      </div>
                      <p>{plan.description}</p>
                    </div>
                    <div className="plan-price-block">
                      <div className="plan-price">{amountLabel}</div>
                      <div className="plan-price-suffix">{suffix}</div>
                    </div>
                  </div>

                  <ul className="plan-feature-list">
                    {plan.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>

                  <div className="plan-footer">
                    {plan.id === "free" ? (
                      signedIn ? (
                        <button className="secondary-button" type="button" disabled={isCurrentPlan}>
                          {isCurrentPlan ? "Current Plan" : "Included"}
                        </button>
                      ) : (
                        <a className="secondary-link" href="/sign-up">
                          Get Started
                        </a>
                      )
                    ) : !signedIn ? (
                      <a className="primary-link" href="/sign-up">
                        Create Account
                      </a>
                    ) : !product ? (
                      <button className="secondary-button" type="button" disabled>
                        Unavailable
                      </button>
                    ) : (
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => void handleCheckout(product.id)}
                        disabled={isPending || isCurrentProduct}
                      >
                        {isCurrentProduct
                          ? "Current Subscription"
                          : isPending
                            ? "Opening Checkout..."
                            : isCurrentPlan
                              ? `Switch to ${formatCycleLabel(billingCycle)}`
                              : plan.ctaLabel}
                      </button>
                    )}

                    {plan.id !== "free" && product?.description ? (
                      <p className="plan-helper-text">{product.description}</p>
                    ) : (
                      <p className="plan-helper-text">
                        {plan.id === "free"
                          ? "No card required."
                          : `Billed ${billingCycle === "month" ? "monthly" : "yearly"} through Stripe Checkout.`}
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}
