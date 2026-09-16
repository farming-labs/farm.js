import { PackageButton } from "@farm-example/ui-kit";

export default function PackageIslandPage() {
  return (
    <main>
      <h1 data-testid="package-title">Client component from a package</h1>
      <PackageButton label="press me" />
    </main>
  );
}
