"use client";

import { useEffect, useRef, useState } from "react";
import type {
  PolarBillingCurrentChargesResult,
  PolarBillingMeterUsageResult,
  PolarBillingStatusResult,
  PolarBillingUsageResult,
  PolarCatalogProduct,
} from "@farmjs/integrations/polar/client";
import { apiClient } from "../../lib/api";
import {
  authOrganizationClient,
  type ActiveOrganizationRecord,
  type AuthOrganizationInvitation,
  type AuthOrganizationRecord,
} from "../../lib/auth-organization-client";
import { authClient } from "../../lib/auth-client";

type SessionPayload = {
  user: {
    id: string;
    email?: string | null;
    name?: string | null;
  };
  session: {
    activeOrganizationId?: string | null;
  };
};

type SessionState =
  | { status: "loading" }
  | { status: "unauthorized" }
  | { status: "ready"; data: SessionPayload };

type BillingState = {
  products: PolarCatalogProduct[];
  status: PolarBillingStatusResult | null;
  currentCharges: PolarBillingCurrentChargesResult | null;
  usage: PolarBillingUsageResult | null;
  meterUsage: PolarBillingMeterUsageResult | null;
};

function scheduleLabel(product: PolarCatalogProduct) {
  if (product.kind === "one_time") {
    return "one-time";
  }

  if (!product.interval) {
    return "recurring";
  }

  return `${product.interval}ly`;
}

function createSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function formatMoney(cents: number | null | undefined, currency = "usd") {
  if (typeof cents !== "number") {
    return "n/a";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function formatUnitAmount(value: string | null | undefined, currency = "usd") {
  if (!value) {
    return "n/a";
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return `${new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(parsed)} / unit`;
}

function formatMeterAggregation(meterUsage: PolarBillingMeterUsageResult | null) {
  if (!meterUsage) {
    return "n/a";
  }

  const quantityKey = meterUsage.quantityMetadataKey ?? "quantity";
  return `${meterUsage.aggregation}(${quantityKey})`;
}

function formatMeterFormula(meterUsage: PolarBillingMeterUsageResult | null) {
  if (!meterUsage) {
    return "n/a";
  }

  if (meterUsage.chargeSource === "subscription_meter") {
    return "Using Polar customer subscription meter amount due so far.";
  }

  if (meterUsage.chargeSource === "catalog_rate") {
    return "Using the current Polar product catalog rate for this meter.";
  }

  if (!meterUsage.meterUnitAmount || typeof meterUsage.currentPeriodUsed !== "number") {
    return "n/a";
  }

  const parsedUnitAmount = Number(meterUsage.meterUnitAmount);
  if (!Number.isFinite(parsedUnitAmount)) {
    return "n/a";
  }

  return `${meterUsage.currentPeriodUsed} × ${parsedUnitAmount} = ${formatMoney(
    meterUsage.estimatedMeterChargeAmount,
    meterUsage.currency ?? "usd",
  )}`;
}

export default function DashboardPage() {
  const meterRetryCountRef = useRef(0);
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const [organizations, setOrganizations] = useState<AuthOrganizationRecord[]>([]);
  const [activeOrganization, setActiveOrganization] = useState<ActiveOrganizationRecord | null>(
    null,
  );
  const [invitations, setInvitations] = useState<AuthOrganizationInvitation[]>([]);
  const [billingState, setBillingState] = useState<BillingState>({
    products: [],
    status: null,
    currentCharges: null,
    usage: null,
    meterUsage: null,
  });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState("Acme Polar");

  async function loadDashboard() {
    const sessionResult = await authClient.getSession();

    if (sessionResult.error || !sessionResult.data?.user || !sessionResult.data?.session) {
      setSession({ status: "unauthorized" });
      setOrganizations([]);
      setActiveOrganization(null);
      setInvitations([]);
      setBillingState({
        products: [],
        status: null,
        currentCharges: null,
        usage: null,
        meterUsage: null,
      });
      return;
    }

    const sessionData = sessionResult.data as SessionPayload;
    setSession({
      status: "ready",
      data: sessionData,
    });

    const [organizationsResult, invitationsResult, productsResult] = await Promise.all([
      authOrganizationClient.list(),
      authOrganizationClient.listUserInvitations(),
      apiClient.billing.products(),
    ]);

    if (organizationsResult.error) {
      setFeedback(organizationsResult.error);
    } else {
      setOrganizations(organizationsResult.data ?? []);
    }

    if (invitationsResult.error) {
      setFeedback(invitationsResult.error);
    } else {
      setInvitations(invitationsResult.data ?? []);
    }

    if (productsResult.error) {
      setFeedback(productsResult.error.message);
    }

    const products = productsResult.data ?? [];

    if (!sessionData.session.activeOrganizationId) {
      setActiveOrganization(null);
      setBillingState({
        products,
        status: null,
        currentCharges: null,
        usage: null,
        meterUsage: null,
      });
      return;
    }

    const [activeOrganizationResult, statusResult, currentChargesResult, usageResult, meterUsageResult] =
      await Promise.all([
        authOrganizationClient.getFullOrganization(),
        apiClient.billing.status(),
        apiClient.billing.currentCharges(),
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
      ]);

    if (activeOrganizationResult.error) {
      setFeedback(activeOrganizationResult.error);
      setActiveOrganization(null);
    } else {
      setActiveOrganization(activeOrganizationResult.data ?? null);
    }

    if (statusResult.error) {
      setFeedback(statusResult.error.message);
    }

    if (currentChargesResult.error) {
      setFeedback(currentChargesResult.error.message);
    }

    if (usageResult.error) {
      setFeedback(usageResult.error.message);
    }

    if (meterUsageResult.error) {
      setFeedback(meterUsageResult.error.message);
    }

    setBillingState({
      products,
      status: statusResult.data ?? null,
      currentCharges: currentChargesResult.data ?? null,
      usage: usageResult.data ?? null,
      meterUsage: meterUsageResult.data ?? null,
    });
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    meterRetryCountRef.current = 0;
  }, [activeOrganization?.id, billingState.status?.productId, billingState.meterUsage?.state]);

  useEffect(() => {
    if (
      session.status !== "ready" ||
      !activeOrganization?.id ||
      !billingState.status?.productId ||
      billingState.meterUsage?.state !== "meter_missing"
    ) {
      return;
    }

    if (meterRetryCountRef.current >= 8) {
      return;
    }

    const timeout = window.setTimeout(() => {
      meterRetryCountRef.current += 1;
      void loadDashboard();
    }, 3000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    session.status,
    activeOrganization?.id,
    billingState.status?.productId,
    billingState.meterUsage?.state,
  ]);

  async function handleCreateOrganization(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAction("create-organization");
    setFeedback(null);

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") || "").trim();
    const slug = createSlug(String(formData.get("slug") || name));

    if (!name || !slug) {
      setFeedback("Enter a name for the organization.");
      setBusyAction(null);
      return;
    }

    const result = await authOrganizationClient.create({
      name,
      slug,
    });

    if (result.error || !result.data?.id) {
      setFeedback(result.error ?? "Could not create organization.");
      setBusyAction(null);
      return;
    }

    const activateResult = await authOrganizationClient.setActive(result.data.id);
    if (activateResult.error) {
      setFeedback(activateResult.error);
      setBusyAction(null);
      return;
    }

    setOrganizationName(name);
    await loadDashboard();
    setBusyAction(null);
  }

  async function handleSetActiveOrganization(organizationId: string) {
    setBusyAction(`set-active:${organizationId}`);
    setFeedback(null);

    const result = await authOrganizationClient.setActive(organizationId);
    if (result.error) {
      setFeedback(result.error);
      setBusyAction(null);
      return;
    }

    await loadDashboard();
    setBusyAction(null);
  }

  async function handleAcceptInvitation(invitationId: string) {
    setBusyAction(`accept:${invitationId}`);
    setFeedback(null);

    const result = await authOrganizationClient.acceptInvitation(invitationId);
    if (result.error) {
      setFeedback(result.error);
      setBusyAction(null);
      return;
    }

    await loadDashboard();
    setBusyAction(null);
  }

  async function handleCheckout(productId: string) {
    if (session.status !== "ready") {
      return;
    }

    setBusyAction(`checkout:${productId}`);
    setFeedback(null);

    const result = await apiClient.billing.checkout({
      body: {
        productId,
        customerEmail: session.data.user.email ?? undefined,
        successPath: "/success",
        cancelPath: "/cancel",
      },
    });

    if (result.error) {
      setFeedback(result.error.message);
      setBusyAction(null);
      return;
    }

    if (result.data?.redirectTo) {
      window.location.assign(result.data.redirectTo);
      return;
    }

    setBusyAction(null);
  }

  async function handleOpenPortal() {
    setBusyAction("portal");
    setFeedback(null);

    const result = await apiClient.billing.portal({
      body: {
        returnTo: "/dashboard",
      },
    });

    if (result.error) {
      setFeedback(result.error.message);
      setBusyAction(null);
      return;
    }

    if (result.data?.redirectTo) {
      window.location.assign(result.data.redirectTo);
      return;
    }

    setBusyAction(null);
  }

  async function handleReportUsage() {
    if (!activeOrganization) {
      setFeedback("Select an active organization before reporting usage.");
      return;
    }

    setBusyAction("report-usage");
    setFeedback(null);

    const result = await apiClient.billing.reportUsage({
      body: {
        key: "tokensMonthly",
        quantity: 25_000,
        idempotencyKey: `polar-demo:${activeOrganization.id}:${Date.now()}`,
        properties: {
          source: "polar-dashboard",
          feature: "usage-demo",
        },
      },
    });

    if (result.error) {
      setFeedback(result.error.message);
      setBusyAction(null);
      return;
    }

    setFeedback(
      `Accepted ${result.data?.quantity ?? 0} tokens for ${result.data?.eventName ?? "meter"}.`,
    );
    await loadDashboard();
    setBusyAction(null);
  }

  async function handleSignOut() {
    setBusyAction("sign-out");
    await authClient.signOut();
    window.location.href = "/";
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <span className="eyebrow">Polar Billing Dashboard</span>
        <h1>Test Polar checkout and metered usage with a real Better Auth organization.</h1>
        <p>
          Sign in, create or select an organization, then run checkout and usage tests.
          The billing owner now comes from the active Better Auth organization.
        </p>
      </section>

      {feedback ? (
        <div className="notice notice-success page-notice">{feedback}</div>
      ) : null}

      {session.status === "loading" ? (
        <section className="card form-card">
          <h2>Loading session...</h2>
          <p>We are checking the Better Auth session before loading your organizations.</p>
        </section>
      ) : null}

      {session.status === "unauthorized" ? (
        <section className="card form-card">
          <h2>Sign in required</h2>
          <p>Create a Better Auth session first, then come back to the Polar dashboard.</p>
          <div className="action-row">
            <a className="primary-link" href="/sign-in">
              Sign In
            </a>
            <a className="secondary-link" href="/sign-up">
              Create Account
            </a>
          </div>
        </section>
      ) : null}

      {session.status === "ready" ? (
        <>
          <section className="playground-grid">
            <section className="card">
              <h2>Session</h2>
              <div className="session-stack">
                <div className="session-line">
                  <strong>User</strong>
                  <span>{session.data.user.name ?? "Unnamed User"}</span>
                </div>
                <div className="session-line">
                  <strong>Email</strong>
                  <span>{session.data.user.email ?? "unknown@farmjs.dev"}</span>
                </div>
                <div className="session-line">
                  <strong>Active organization</strong>
                  <span>{activeOrganization?.name ?? "none selected"}</span>
                </div>
              </div>
              <div className="action-row">
                <button className="ghost-button" type="button" onClick={() => void loadDashboard()}>
                  Refresh Dashboard
                </button>
                <button
                  className="secondary-link"
                  type="button"
                  onClick={() => void handleSignOut()}
                  disabled={busyAction === "sign-out"}
                >
                  {busyAction === "sign-out" ? "Signing Out..." : "Sign Out"}
                </button>
              </div>
            </section>

            <section className="card">
              <h2>Organizations</h2>
              <form className="inline-form" onSubmit={handleCreateOrganization}>
                <input
                  className="input"
                  name="name"
                  value={organizationName}
                  onChange={(event) => setOrganizationName(event.target.value)}
                  placeholder="Acme Polar"
                  type="text"
                />
                <input
                  className="input"
                  name="slug"
                  placeholder={createSlug(organizationName) || "acme-polar"}
                  type="text"
                />
                <button
                  className="primary-button"
                  type="submit"
                  disabled={busyAction === "create-organization"}
                >
                  {busyAction === "create-organization" ? "Creating..." : "Create Organization"}
                </button>
              </form>

              <div className="list-stack">
                {organizations.map((organization) => {
                  const active = organization.id === activeOrganization?.id;

                  return (
                    <div className="list-item" key={organization.id}>
                      <div>
                        <strong>{organization.name}</strong>
                        <div className="muted-line">{organization.slug}</div>
                      </div>
                      <button
                        className={active ? "secondary-link" : "ghost-button"}
                        disabled={busyAction === `set-active:${organization.id}` || active}
                        onClick={() => void handleSetActiveOrganization(organization.id)}
                        type="button"
                      >
                        {active
                          ? "Active"
                          : busyAction === `set-active:${organization.id}`
                            ? "Switching..."
                            : "Set Active"}
                      </button>
                    </div>
                  );
                })}
              </div>

              {invitations.length > 0 ? (
                <div className="invitation-box">
                  <strong>Pending invitations</strong>
                  <div className="list-stack">
                    {invitations.map((invitation) => (
                      <div className="list-item" key={invitation.id}>
                        <div>
                          <strong>{invitation.organizationName ?? invitation.organizationId}</strong>
                          <div className="muted-line">{invitation.email}</div>
                        </div>
                        <button
                          className="ghost-button"
                          disabled={busyAction === `accept:${invitation.id}`}
                          onClick={() => void handleAcceptInvitation(invitation.id)}
                          type="button"
                        >
                          {busyAction === `accept:${invitation.id}` ? "Accepting..." : "Accept"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          </section>

          <section className="playground-grid">
            <section className="card">
              <h2>Billing Status</h2>
              {activeOrganization ? (
                <>
                  <div className="session-stack">
                    <div className="session-line">
                      <strong>Plan</strong>
                      <span>{billingState.status?.planId ?? "free"}</span>
                    </div>
                    <div className="session-line">
                      <strong>Product</strong>
                      <span>{billingState.status?.productId ?? "none"}</span>
                    </div>
                    <div className="session-line">
                      <strong>Customer</strong>
                      <span>{billingState.status?.customerId ?? "not created yet"}</span>
                    </div>
                    <div className="session-line">
                      <strong>Status</strong>
                      <span>{billingState.status?.status ?? "free"}</span>
                    </div>
                    <div className="session-line">
                      <strong>Current Period End</strong>
                      <span>{billingState.status?.currentPeriodEnd ?? "n/a"}</span>
                    </div>
                  </div>

                  <div className="action-row">
                    <button
                      className="primary-button"
                      disabled={busyAction === "portal"}
                      onClick={() => void handleOpenPortal()}
                      type="button"
                    >
                      {busyAction === "portal" ? "Opening..." : "Open Polar Portal"}
                    </button>
                  </div>
                </>
              ) : (
                <p>Create or select an active organization before testing billing.</p>
              )}
            </section>

            <section className="card">
              <h2>Checkout Products</h2>
              <div className="product-grid">
                {billingState.products.map((product) => {
                  const amount =
                    typeof product.unitAmount === "number"
                      ? (product.unitAmount / 100).toFixed(2)
                      : null;
                  const isPending = busyAction === `checkout:${product.id}`;

                  return (
                    <article className="product-card" key={product.id}>
                      <div className="product-copy">
                        <span className="status-pill">{scheduleLabel(product)}</span>
                        <h3>{product.name}</h3>
                        <p>{product.description || "Configured locally and purchased through Polar."}</p>
                      </div>
                      <div className="product-footer">
                        <div className="product-price">
                          {amount ? `$${amount}` : "Polar product"}
                          {amount && product.kind === "subscription" && product.interval
                            ? ` / ${product.interval}`
                            : ""}
                        </div>
                        <button
                          className="primary-button"
                          disabled={!activeOrganization || isPending}
                          onClick={() => void handleCheckout(product.id)}
                          type="button"
                        >
                          {isPending ? "Opening Checkout..." : "Start Checkout"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </section>

          <section className="playground-grid">
            <section className="card">
              <h2>Current Cycle Charges</h2>
              {activeOrganization ? (
                billingState.currentCharges ? (
                  <>
                    <p>
                      This is the pending Polar bill for the active cycle. It combines the base
                      subscription with the meter amount Polar has recorded so far.
                    </p>
                    <div className="session-stack">
                      <div className="session-line">
                        <strong>Billing Period</strong>
                        <span>
                          {billingState.currentCharges.currentPeriodStart &&
                          billingState.currentCharges.currentPeriodEnd
                            ? `${new Date(
                                billingState.currentCharges.currentPeriodStart,
                              ).toLocaleDateString()} - ${new Date(
                                billingState.currentCharges.currentPeriodEnd,
                              ).toLocaleDateString()}`
                            : "n/a"}
                        </span>
                      </div>
                      <div className="session-line">
                        <strong>Pending Meter Charge</strong>
                        <span>
                          {formatMoney(
                            billingState.currentCharges.pendingMeterChargeAmount,
                            billingState.currentCharges.currency,
                          )}
                        </span>
                      </div>
                      <div className="session-line">
                        <strong>Estimated Total If Invoiced Now</strong>
                        <span>
                          {formatMoney(
                            billingState.currentCharges.estimatedTotalAmount,
                            billingState.currentCharges.currency,
                          )}
                        </span>
                      </div>
                    </div>

                    {(() => {
                      const currentCharges = billingState.currentCharges;
                      if (!currentCharges?.lineItems.length) {
                        return <p>No pending charges yet for this Polar customer.</p>;
                      }

                      return (
                        <div className="list-stack">
                          {currentCharges.lineItems.map(
                            (line: PolarBillingCurrentChargesResult["lineItems"][number]) => (
                              <div className="list-item" key={`${line.kind}:${line.key ?? line.label}`}>
                                <div>
                                  <strong>
                                    {line.label} · {formatMoney(line.amount, currentCharges.currency)}
                                  </strong>
                                  <div className="muted-line">
                                    {line.kind === "metered_usage"
                                      ? `${line.quantity?.toLocaleString() ?? "0"} used · ${
                                          line.includedUnits?.toLocaleString() ?? "0"
                                        } included · ${
                                          line.overageUnits?.toLocaleString() ?? "0"
                                        } overage${
                                          line.unitAmountDecimal
                                            ? ` × ${formatUnitAmount(
                                                line.unitAmountDecimal,
                                                currentCharges.currency,
                                              )}`
                                            : ""
                                        }`
                                      : "Recurring base subscription for the active Polar plan."}
                                  </div>
                                </div>
                              </div>
                            ),
                          )}
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <p>We couldn&apos;t load the current Polar charge breakdown for this org yet.</p>
                )
              ) : (
                <p>Select an active organization to see current Polar billing for this cycle.</p>
              )}
            </section>

            <section className="card">
              <h2>Meter Debug</h2>
              {activeOrganization ? (
                <>
                  <div className="session-stack">
                    <div className="session-line">
                      <strong>App Usage Key</strong>
                      <span>{billingState.usage?.key ?? "tokensMonthly"}</span>
                    </div>
                    <div className="session-line">
                      <strong>App Usage</strong>
                      <span>{billingState.usage?.used ?? 0}</span>
                    </div>
                    <div className="session-line">
                      <strong>Plan Limit</strong>
                      <span>{billingState.usage?.limit ?? "n/a"}</span>
                    </div>
                    <div className="session-line">
                      <strong>Meter Name</strong>
                      <span>{billingState.meterUsage?.meterName ?? "n/a"}</span>
                    </div>
                    <div className="session-line">
                      <strong>Meter Event</strong>
                      <span>{billingState.meterUsage?.eventName ?? "n/a"}</span>
                    </div>
                    <div className="session-line">
                      <strong>Meter Aggregation</strong>
                      <span>{formatMeterAggregation(billingState.meterUsage)}</span>
                    </div>
                    <div className="session-line">
                      <strong>Polar Meter Used</strong>
                      <span>{billingState.meterUsage?.currentPeriodUsed ?? 0}</span>
                    </div>
                    <div className="session-line">
                      <strong>Meter Balance</strong>
                      <span>{billingState.meterUsage?.balance ?? "n/a"}</span>
                    </div>
                    <div className="session-line">
                      <strong>Base Subscription</strong>
                      <span>
                        {formatMoney(
                          billingState.meterUsage?.baseSubscriptionAmount,
                          billingState.meterUsage?.currency ?? "usd",
                        )}
                      </span>
                    </div>
                    <div className="session-line">
                      <strong>Current Catalog Meter Rate</strong>
                      <span>
                        {formatUnitAmount(
                          billingState.meterUsage?.meterUnitAmount,
                          billingState.meterUsage?.currency ?? "usd",
                        )}
                      </span>
                    </div>
                    <div className="session-line">
                      <strong>Meter Cap</strong>
                      <span>
                        {formatMoney(
                          billingState.meterUsage?.meterCapAmount,
                          billingState.meterUsage?.currency ?? "usd",
                        )}
                      </span>
                    </div>
                    <div className="session-line">
                      <strong>Charge Source</strong>
                      <span>
                        {billingState.meterUsage?.chargeSource === "subscription_meter"
                          ? "Polar subscription meter"
                          : "Current product rate"}
                      </span>
                    </div>
                    <div className="session-line">
                      <strong>Estimated Meter Charge</strong>
                      <span>
                        {formatMoney(
                          billingState.meterUsage?.estimatedMeterChargeAmount,
                          billingState.meterUsage?.currency ?? "usd",
                        )}
                      </span>
                    </div>
                    <div className="session-line">
                      <strong>Charge Formula</strong>
                      <span>{formatMeterFormula(billingState.meterUsage)}</span>
                    </div>
                    <div className="session-line">
                      <strong>Estimated Total If Invoiced Now</strong>
                      <span>
                        {formatMoney(
                          billingState.meterUsage?.estimatedCombinedAmount,
                          billingState.meterUsage?.currency ?? "usd",
                        )}
                      </span>
                    </div>
                    <div className="session-line">
                      <strong>Meter State</strong>
                      <span>{billingState.meterUsage?.state ?? "unknown"}</span>
                    </div>
                    <div className="session-line">
                      <strong>Configured Meter</strong>
                      <span>{billingState.meterUsage?.meterId ?? "n/a"}</span>
                    </div>
                    <div className="session-line">
                      <strong>Customer Active Meters</strong>
                      <span>
                        {billingState.meterUsage?.activeMeterIds?.length
                          ? billingState.meterUsage.activeMeterIds.join(", ")
                          : "none"}
                      </span>
                    </div>
                  </div>

                  {billingState.meterUsage?.warning ? (
                    <div className="notice notice-error">{billingState.meterUsage.warning}</div>
                  ) : null}

                  <div className="mode-box">
                    <strong>How to read these numbers</strong>
                    <p>
                      Polar customer state reports the fixed subscription amount separately from
                      metered usage. When available, the estimated meter charge above comes from
                      the customer subscription meter amount Polar has already computed. The
                      catalog rate is shown separately so you can compare the current product
                      pricing against the customer&apos;s active subscription pricing.
                    </p>
                  </div>

                  {billingState.meterUsage?.state === "meter_missing" ? (
                    <div className="mode-box">
                      <strong>The subscription is on a different Polar meter configuration.</strong>
                      <p>
                        The app is reporting usage to the configured meter above, but the active
                        customer subscription does not currently expose that meter in Polar
                        customer state. We automatically retry for a few seconds after checkout,
                        because Polar customer state can lag briefly. If it still stays here after
                        a refresh, the active org probably completed checkout on older pricing and
                        needs a fresh checkout or subscription pricing update.
                      </p>
                    </div>
                  ) : null}

                  <div className="action-row">
                    <button
                      className="primary-button"
                      disabled={busyAction === "report-usage"}
                      onClick={() => void handleReportUsage()}
                      type="button"
                    >
                      {busyAction === "report-usage"
                        ? "Reporting..."
                        : "Report 25k Metered Tokens"}
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void loadDashboard()}
                    >
                      Refresh Meter State
                    </button>
                  </div>
                </>
              ) : (
                <p>Select an active organization before reporting Polar usage.</p>
              )}
            </section>

            <section className="card">
              <h2>Raw Responses</h2>
              <p>
                Keep this visible while testing so you can confirm customer state,
                active organization, and meter totals without leaving the app.
              </p>
              <pre className="response-pre">
                {JSON.stringify(
                  {
                    session: session.data,
                    activeOrganization,
                    billingState,
                  },
                  null,
                  2,
                )}
              </pre>
            </section>
          </section>
        </>
      ) : null}
    </main>
  );
}
