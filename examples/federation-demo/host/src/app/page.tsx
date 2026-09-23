import { FederatedCheckout } from "./federated-checkout";

export default function Page() {
  return (
    <main>
      <section className="hero">
        <div>
          <p className="eyebrow">Consumer · :4100</p>
          <h1>One product surface. Independently shipped modules.</h1>
          <p className="lede">
            The storefront owns this shell. Checkout owns the interactive module beside it and can
            deploy without rebuilding the host.
          </p>
        </div>
        <dl>
          <div>
            <dt>Host</dt>
            <dd>storefront</dd>
          </div>
          <div>
            <dt>Remote</dt>
            <dd>checkout/UpgradeCard</dd>
          </div>
          <div>
            <dt>Shared</dt>
            <dd>React singleton</dd>
          </div>
        </dl>
      </section>

      <section className="module-stage" aria-labelledby="module-title">
        <div className="stage-copy">
          <p className="eyebrow">Runtime boundary</p>
          <h2 id="module-title">Loaded after hydration</h2>
          <p>
            Farm keeps the server graph local, then the browser resolves the producer manifest and
            downloads only the exposed module and its assets.
          </p>
        </div>
        <FederatedCheckout />
      </section>
    </main>
  );
}
