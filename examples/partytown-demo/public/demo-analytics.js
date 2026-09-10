window.demoAnalytics = {
  track(event, properties) {
    return fetch("/api/analytics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, properties }),
    });
  },
};
