import { createEndpoint } from "@farm.js/core";
import { listStations } from "../../../features/stations/data";

/** The stations the /map native screen lists. */
export const GET = createEndpoint("/api/stations", { method: "GET" }, async () => listStations());
