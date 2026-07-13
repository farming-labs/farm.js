"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

type CtaFrameProps = {
  children: ReactNode;
};

export function CtaFrame({ children }: CtaFrameProps) {
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
      { rootMargin: "0px 0px -12%", threshold: 0.3 },
    );

    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={frameRef}
      className="farm-cta-frame relative mx-auto w-full max-w-3xl px-5 py-7 text-center sm:px-9 sm:py-8"
      data-visible={isVisible}
    >
      <div aria-hidden="true" className="farm-cta-frame-border">
        <span className="farm-cta-frame-corner farm-cta-frame-corner-tl" />
        <span className="farm-cta-frame-corner farm-cta-frame-corner-tr" />
        <span className="farm-cta-frame-corner farm-cta-frame-corner-bl" />
        <span className="farm-cta-frame-corner farm-cta-frame-corner-br" />
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
}
