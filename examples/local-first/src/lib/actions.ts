import { apiClient } from "./api";

/**
 * The client-side reference to the server's rule. useSyncAction accepts any
 * promise-returning function; this one rides the typed API client, so the
 * route, the payload, and the returned row are all checked against the
 * generated router.
 */
export async function completeTask(input: { id: string }) {
  const { data, error } = await apiClient.tasks.complete.post({ body: input });
  if (error) throw new Error(error.message);
  return data;
}
