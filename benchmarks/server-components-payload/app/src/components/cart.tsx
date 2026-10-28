"use client";
import { createContext, useContext, useState, type ReactNode } from "react";

const Cart = createContext<{ items: string[]; add(id: string): void } | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<string[]>([]);
  return (
    <Cart.Provider value={{ items, add: (id) => setItems((current) => [...current, id]) }}>
      {children}
    </Cart.Provider>
  );
}

export function useCart() {
  const cart = useContext(Cart);
  if (!cart) throw new Error("useCart must be used within CartProvider");
  return cart;
}

export function CartBadge() {
  return <p data-cart>{`Cart: ${useCart().items.length}`}</p>;
}
