window.demoAnalytics = {
  events: [],
  track(event, properties) {
    const recorded = { event, properties, recordedAt: new Date().toISOString() };
    this.events.push(recorded);
    return recorded;
  },
};
