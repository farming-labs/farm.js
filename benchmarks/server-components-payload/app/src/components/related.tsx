"use client";
import type { Product } from "../data";
import { useCart } from "./cart";

export function RelatedProducts({ products }: { products: Product[] }) {
  const cart = useCart();
  return (
    <ul>
      {products.map((product) => (
        <li key={product.id}>
          <a href={product.href}>{product.name}</a> {`$${product.price}`}{" "}
          <button type="button" onClick={() => cart.add(product.id)}>
            Add
          </button>
        </li>
      ))}
    </ul>
  );
}
