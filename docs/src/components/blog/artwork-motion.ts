// CSS owns the motion; pause decorative work offscreen and in background tabs.
export function enhanceArtwork(element: HTMLElement) {
  if (!("IntersectionObserver" in window)) return () => {};
  let visible = false;
  function update() {
    element.dataset.motion = !document.hidden && visible ? "running" : "paused";
  }
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    update();
  });
  observer.observe(element);
  document.addEventListener("visibilitychange", update);
  return () => {
    observer.disconnect();
    document.removeEventListener("visibilitychange", update);
    delete element.dataset.motion;
  };
}
