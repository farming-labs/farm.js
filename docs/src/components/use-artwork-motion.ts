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
    // A callback can carry several entries for one element (off screen, then back on after a
    // navigation scrolls to the top); the last one is current.
    const observer = new IntersectionObserver((entries) => {
      visible = entries[entries.length - 1].isIntersecting;
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
