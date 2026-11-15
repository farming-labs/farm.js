import type { ProgrammaticRouteComponentProps } from "@farm.js/core";
import { Link } from "@farm.js/core/client";
import type { StationData } from "../../farm.routes";
import "../../app/globals.css";

type StationPageProps = ProgrammaticRouteComponentProps<{ id: string }, {}, StationData>;

export function StationPage({ data }: StationPageProps) {
  return (
    <main className="page">
      <h1 className="page-title">{data.name}</h1>
      <p className="meta" data-testid="station-meta">
        {data.elevationM} m, loader run {data.load}
      </p>
      <ul className="list" data-testid="station-readings">
        {data.readings.map((reading) => (
          <li key={reading.hour} className="row">
            <strong>{reading.hour}</strong>
            <span>
              {reading.tempC} °C, wind {reading.windKph} km/h
            </span>
          </li>
        ))}
      </ul>
      <div className="actions">
        <Link className="button secondary" href="/stations/lake">
          Lake shelter
        </Link>
        <Link className="button secondary" href="/stations/pass">
          High pass
        </Link>
      </div>
    </main>
  );
}
