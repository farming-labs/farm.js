import type { Metadata } from "@farm.js/core";
import { Link } from "@farm.js/core/client";

export const metadata: Metadata = {
  title: "Cart | Farm.js",
};

export default function CartPage() {
  return (
    <div className="space-y-4">
      <h1 data-testid="shop-page">Cart</h1>
      <Link href="/about" data-testid="cart-link-about">
        Back to about
      </Link>
    </div>
  );
}
