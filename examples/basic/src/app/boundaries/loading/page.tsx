import React from "react";

const SlowDetails = React.lazy(async () => {
  await new Promise((resolve) => setTimeout(resolve, 280));
  return import("./slow-details");
});

export default function RouteLoadingBoundaryPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Route Loading Boundary Demo</h1>
      <p className="text-gray-600">This route intentionally suspends so the route-level loading boundary is rendered.</p>
      <SlowDetails />
    </section>
  );
}
