import type { ReactNode } from "react";
import { CartBadge, CartProvider } from "../../components/cart";

// A client provider around the pages: the layout hydrates as one root and pages join its tree.
export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <CartProvider>
      <CartBadge />
      <main>{children}</main>
    </CartProvider>
  );
}
