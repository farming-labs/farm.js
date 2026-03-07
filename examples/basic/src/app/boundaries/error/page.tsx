import React from "react";

export default function RouteErrorBoundaryPage() {
  throw new Error("Intentional route error for boundary e2e test");
}
