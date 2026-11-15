/** The example's data. A real app would read a database; the tiers work the same. */
export interface Trail {
  id: string;
  name: string;
  region: string;
  km: number;
  climb: string;
  notes: string;
}

export const trails: Trail[] = [
  {
    id: "creek",
    name: "Creek Loop",
    region: "Lower valley",
    km: 4.2,
    climb: "Easy",
    notes: "Flat gravel along the creek; shaded after noon. Good first walk of the season.",
  },
  {
    id: "ridge",
    name: "Ridge Traverse",
    region: "North ridge",
    km: 11.8,
    climb: "Hard",
    notes: "Exposed above the tree line for 3 km. Carry water; the spring at the saddle is dry.",
  },
  {
    id: "orchard",
    name: "Orchard Path",
    region: "East fields",
    km: 2.6,
    climb: "Easy",
    notes: "Through the old orchard rows. Muddy for a day or two after rain.",
  },
  {
    id: "falls",
    name: "Falls Overlook",
    region: "Upper valley",
    km: 7.5,
    climb: "Moderate",
    notes: "Steady switchbacks to the overlook. The last bench before the top faces the falls.",
  },
];

export function getTrail(id: string): Trail | undefined {
  return trails.find((trail) => trail.id === id);
}
