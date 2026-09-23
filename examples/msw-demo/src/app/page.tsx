import { BrowserStatus } from "./browser-status";

export default function Page() {
  return (
    <div className="demo">
      <header>
        <p className="eyebrow">@farm.js/msw</p>
        <h1>One handler set. Both development runtimes.</h1>
        <p className="intro">
          The endpoint below does not exist. Farm loads the same MSW handlers before SSR and before
          browser hydration, so both requests still resolve.
        </p>
      </header>

      <BrowserStatus />

      <div className="request-line">
        <span>GET</span>
        <code>https://inventory.farm.test/status</code>
        <strong>200 MOCKED</strong>
      </div>
    </div>
  );
}
