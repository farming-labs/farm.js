import type { POST as POST_greeting } from "../app/api/greeting/route";

export type APIRouter = {
  greeting: {
    post: typeof POST_greeting;
  };
};
