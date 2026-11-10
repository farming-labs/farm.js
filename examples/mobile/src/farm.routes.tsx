import { createRoute, defineRoutes, notFound } from "@farm.js/core";
import { z } from "zod";
import { loadStation, type Station } from "./features/stations/data";
import { StationPage } from "./features/stations/page";

export type StationData = Station & { load: number };

/** A route whose data comes from a loader: `data.main` runs on the server for SSR and SPA visits. */
export const StationRoute = createRoute("/stations/[id]", {
  params: z.object({ id: z.string().min(1) }),
  data: {
    key: ({ params }) => ["station", params.id],
    staleTime: "30s",
    async main({ params }): Promise<StationData> {
      const station = await loadStation(params.id);
      if (!station) notFound();
      return station;
    },
  },
  component: StationPage,
  metadata: { title: "Station" },
});

export default defineRoutes(() => [StationRoute]);
