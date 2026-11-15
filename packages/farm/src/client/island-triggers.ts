interface VisibilityRegistry {
  observer: IntersectionObserver;
  targets: Map<Element, Set<() => void>>;
}

const visibilityRegistries = new WeakMap<Document, VisibilityRegistry>();

/** Share the fixed island visibility policy; release targets as soon as they fire. */
export function observeIslandVisibility(
  document: Document,
  targets: Element[],
  start: () => void,
): () => void {
  let registry = visibilityRegistries.get(document);
  if (!registry) {
    const subscriptions = new Map<Element, Set<() => void>>();
    const observer = new IntersectionObserver(
      (entries) => {
        const pending = new Set<() => void>();
        for (const entry of entries) {
          if (entry.isIntersecting) {
            for (const callback of subscriptions.get(entry.target) ?? []) pending.add(callback);
          }
        }
        for (const callback of pending) callback();
      },
      { rootMargin: "200px" },
    );
    registry = { observer, targets: subscriptions };
    visibilityRegistries.set(document, registry);
  }
  for (const target of targets) {
    let callbacks = registry.targets.get(target);
    if (!callbacks) {
      callbacks = new Set();
      registry.targets.set(target, callbacks);
      registry.observer.observe(target);
    }
    callbacks.add(start);
  }
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    for (const target of targets) {
      const callbacks = registry.targets.get(target);
      callbacks?.delete(start);
      if (callbacks?.size === 0) {
        registry.targets.delete(target);
        registry.observer.unobserve(target);
      }
    }
    if (registry.targets.size === 0) {
      registry.observer.disconnect();
      visibilityRegistries.delete(document);
    }
  };
}
