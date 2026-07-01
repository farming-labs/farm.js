"use client";

import { useEffect, useState } from "react";
import type { StripeCatalogProduct } from "@farmjs/integrations/stripe/client";
import { apiClient } from "../lib/api";

type ProductState =
  | { status: "loading"; products: StripeCatalogProduct[]; message?: string }
  | { status: "ready"; products: StripeCatalogProduct[]; message?: string }
  | { status: "error"; products: StripeCatalogProduct[]; message: string };

function scheduleLabel(product: StripeCatalogProduct) {
  if (product.mode === "payment") {
    return "one-time";
  }

  if (!product.interval) {
    return "recurring";
  }

  return `${product.interval}ly`;
}

export function HomeClient() {
  const [customerEmail, setCustomerEmail] = useState("demo@farmjs.dev");
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
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

  return (
    <main className="page-shell">
      <section className="hero">
        <span className="eyebrow">Stripe Payments</span>
        <h1>Stripe Integration</h1>
        <p>
          Start hosted Stripe Checkout through the typed Farm client, read the
          Checkout Session back inside the app, and open the Billing Portal after
          payment. The paid plans below are listed from Stripe price ids rather
          than being hardcoded into the page.
        </p>
      </section>

      <section className="playground-grid">
        <section className="card">
          <h2>Checkout</h2>
          <label className="field">
            <span>Customer Email</span>
            <input
              className="input"
              type="email"
              value={customerEmail}
              onChange={(event) => setCustomerEmail(event.target.value)}
              placeholder="demo@farmjs.dev"
            />
          </label>

          {feedback ? <div className="notice notice-error">{feedback}</div> : null}
          {products.status === "loading" ? <p>Loading Stripe products...</p> : null}
          {products.status === "error" ? (
            <div className="notice notice-error">{products.message}</div>
          ) : null}

          <div className="product-grid">
            <article className="product-card">
              <div className="product-copy">
                <span className="status-pill">free</span>
                <h3>Free</h3>
                <p>Baseline access with no Stripe checkout required.</p>
              </div>
              <div className="product-footer">
                <div className="product-price">$0</div>
                <a className="secondary-link" href="/">
                  Current App Plan
                </a>
              </div>
            </article>

            {products.products.map((product) => {
              const amount =
                typeof product.unitAmount === "number"
                  ? (product.unitAmount / 100).toFixed(2)
                  : null;
              const isPending = pendingProductId === product.id;

              return (
                <article className="product-card" key={product.id}>
                  <div className="product-copy">
                    <span className="status-pill">{scheduleLabel(product)}</span>
                    <h3>{product.name}</h3>
                    <p>{product.description || "Loaded from Stripe."}</p>
                  </div>
                  <div className="product-footer">
                    <div className="product-price">
                      {amount ? `$${amount}` : "Stripe price"}
                      {amount && product.mode === "subscription" && product.interval
                        ? ` / ${product.interval}`
                        : ""}
                    </div>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => void handleCheckout(product.id)}
                      disabled={isPending}
                    >
                      {isPending ? <span className="button-spinner" aria-hidden="true" /> : null}
                      <span>{isPending ? "Opening Checkout..." : "Start Checkout"}</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="card">
          <h2>Integration Routes</h2>
          <div className="session-stack">
            <div className="session-line">
              <strong>/billing/products</strong>
              <span>Used by <code>apiClient.billing.products()</code> to list products from Stripe.</span>
            </div>
            <div className="session-line">
              <strong>/billing/checkout</strong>
              <span>Used by <code>apiClient.billing.checkout()</code>.</span>
            </div>
            <div className="session-line">
              <strong>/billing/session</strong>
              <span>Used by <code>apiClient.billing.session()</code> on the success page.</span>
            </div>
            <div className="session-line">
              <strong>/billing/portal</strong>
              <span>Used by <code>apiClient.billing.portal()</code> after checkout.</span>
            </div>
            <div className="session-line">
              <strong>/billing/webhook</strong>
              <span>Verifies webhook payloads and logs the received event.</span>
            </div>
          </div>

          <div className="mode-box">
            <strong>Hosted Stripe test mode is active.</strong>
            <p>
              Free is local UI state, while paid products are fetched from Stripe
              by price id and then purchased through hosted Checkout.
            </p>
          </div>
        </section>
      </section>
    </main>
  );
}
