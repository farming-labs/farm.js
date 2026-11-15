"use client";
import Balancer from "react-wrap-balancer";

export function BalancedFromClient() {
  return (
    <p data-testid="balancer-client">
      <Balancer>balanced from a client component</Balancer>
    </p>
  );
}
