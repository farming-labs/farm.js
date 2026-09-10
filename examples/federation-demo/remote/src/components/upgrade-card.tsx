"use client";

import { useState } from "react";
import "./upgrade-card.css";

export interface UpgradeCardProps {
  workspace: string;
  onUpgrade?: (seats: number) => void;
}

export default function UpgradeCard({ workspace, onUpgrade }: UpgradeCardProps) {
  const [seats, setSeats] = useState(4);

  return (
    <article className="upgrade-card" data-testid="federated-upgrade-card">
      <div className="upgrade-card__status">
        <span aria-hidden="true" /> Remote module connected
      </div>
      <div className="upgrade-card__heading">
        <div>
          <p>{workspace}</p>
          <h2>Scale the workspace</h2>
        </div>
        <strong>${seats * 12}</strong>
      </div>
      <p className="upgrade-card__copy">
        This component, its state, and its styles came from the checkout deployment.
      </p>
      <div className="upgrade-card__controls">
        <label htmlFor="seat-count">Seats</label>
        <div>
          <button
            type="button"
            aria-label="Remove one seat"
            disabled={seats === 1}
            onClick={() => setSeats((current) => Math.max(1, current - 1))}
          >
            −
          </button>
          <output id="seat-count" aria-live="polite">
            {seats}
          </output>
          <button
            type="button"
            aria-label="Add one seat"
            onClick={() => setSeats((current) => current + 1)}
          >
            +
          </button>
        </div>
      </div>
      <button className="upgrade-card__action" type="button" onClick={() => onUpgrade?.(seats)}>
        Continue with {seats} seats
      </button>
    </article>
  );
}
