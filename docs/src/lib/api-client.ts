import { createAPIClient } from "@farmjs/core/client";
import type { APIRouter } from "./api.generated";

export const api = createAPIClient<APIRouter>();
