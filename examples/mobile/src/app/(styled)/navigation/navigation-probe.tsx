"use client";

import { navigateTo, useRouter } from "@farm.js/core/client";
import { useEffect, useState } from "react";

function currentLocation(): string {
  return typeof window === "undefined"
    ? ""
    : `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

/** Shows where the page is and drives programmatic navigations and history. */
export function NavigationProbe() {
  const router = useRouter();
  const [where, setWhere] = useState("");
  const [events, setEvents] = useState<string[]>([]);

  useEffect(() => {
    const update = (kind: string) => () => {
      setWhere(currentLocation());
      setEvents((list) => [...list.slice(-4), `${kind} ${currentLocation()}`]);
    };
    setWhere(currentLocation());
    const onPop = update("popstate");
    const onHash = update("hashchange");
    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  return (
    <section className="card">
      <p className="meta" data-testid="where">
        {where}
      </p>
      <div className="actions">
        <button className="button secondary" type="button" onClick={() => history.back()} data-testid="back">
          Back
        </button>
        <button className="button secondary" type="button" onClick={() => history.forward()} data-testid="forward">
          Forward
        </button>
        <button className="button secondary" type="button" onClick={() => navigateTo("/feed")} data-testid="navigate-to">
          navigateTo(/feed)
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={() => router.replace("/navigation?filter=router")}
          data-testid="router-replace"
        >
          router.replace
        </button>
      </div>
      <ol className="meta" data-testid="events">
        {events.map((event, index) => (
          <li key={index}>{event}</li>
        ))}
      </ol>
    </section>
  );
}
