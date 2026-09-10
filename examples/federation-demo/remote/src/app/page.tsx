import UpgradeCard from "../components/upgrade-card";

export default function Page() {
  return (
    <main className="remote-page">
      <header>
        <p className="eyebrow">Producer · :4101</p>
        <h1>The checkout team owns this deployment.</h1>
        <p>
          This Farm app publishes the card below as <code>checkout/UpgradeCard</code>. It can ship
          independently from the storefront consuming it.
        </p>
      </header>
      <UpgradeCard workspace="Remote preview" />
    </main>
  );
}
