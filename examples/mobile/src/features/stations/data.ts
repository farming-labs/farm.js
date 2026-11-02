// Server-only station readings for the /stations/[id] route loader.

export interface Station {
  id: string;
  name: string;
  elevationM: number;
  readings: Array<{ hour: string; tempC: number; windKph: number }>;
}

const STATIONS: Record<string, Omit<Station, "readings">> = {
  north: { id: "north", name: "North ridge", elevationM: 2140 },
  lake: { id: "lake", name: "Lake shelter", elevationM: 1620 },
  pass: { id: "pass", name: "High pass", elevationM: 2890 },
};

export function listStations(): Array<Omit<Station, "readings">> {
  return Object.values(STATIONS);
}

let loads = 0;

/** Deterministic readings, so screenshots and tests are stable. */
export async function loadStation(id: string): Promise<(Station & { load: number }) | undefined> {
  const station = STATIONS[id];
  if (!station) return undefined;
  const seed = station.elevationM / 100;
  return {
    ...station,
    load: ++loads,
    readings: Array.from({ length: 6 }, (_, index) => ({
      hour: `${String(6 + index * 2).padStart(2, "0")}:00`,
      tempC: Math.round((12 - seed / 4 + Math.sin(index) * 3) * 10) / 10,
      windKph: Math.round(seed + index * 2),
    })),
  };
}
