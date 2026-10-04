import { useEffect, useRef, useState } from "react";

/**
 * CSS owns the artwork's motion; this only runs it while the artwork is on screen and the tab is
 * in front. Without JavaScript (and before hydration) `data-motion` is absent and nothing moves.
 */
export function useArtworkMotion<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [motion, setMotion] = useState<"running" | "paused">();

  useEffect(() => {
    const element = ref.current;
    if (!element || !("IntersectionObserver" in window)) return;
    let visible = false;
    const update = () => setMotion(!document.hidden && visible ? "running" : "paused");
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return [ref, motion] as const;
}
