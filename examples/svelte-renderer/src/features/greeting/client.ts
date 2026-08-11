import { createAPIClient } from "@farm.js/core/client";
import type { APIRouter } from "../../lib/api.generated";

export const api = createAPIClient<APIRouter>();
