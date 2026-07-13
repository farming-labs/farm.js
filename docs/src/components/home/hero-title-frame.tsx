"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

type HeroTitleFrameProps = {
  children: ReactNode;
};

export function HeroTitleFrame({ children }: HeroTitleFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    if (
      !("IntersectionObserver" in window) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;

        setIsVisible(true);
        observer.disconnect();
      },
      { threshold: 0.3 },
    );

    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={frameRef}
      className="farm-hero-title-frame relative mt-7 w-fit max-w-full px-4 py-4 sm:px-5 sm:py-5"
      data-visible={isVisible}
    >
      <div aria-hidden="true" className="farm-hero-title-frame-border">
        <span className="farm-hero-title-frame-corner farm-hero-title-frame-corner-tl" />
        <span className="farm-hero-title-frame-corner farm-hero-title-frame-corner-tr" />
        <span className="farm-hero-title-frame-corner farm-hero-title-frame-corner-bl" />
        <span className="farm-hero-title-frame-corner farm-hero-title-frame-corner-br" />
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
}
