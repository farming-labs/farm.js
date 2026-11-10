"use client";
import useSWR from "swr";

// The fallback stands until a fetch succeeds; /api/user does not exist, so it never does.
const fetcher = (url: string) =>
  fetch(url).then(async (response) => {
    const body = await response.json();
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return body;
  });

export function SwrUser() {
  const { data } = useSWR<{ name: string }>("/api/user", fetcher, { shouldRetryOnError: false });
  return <p data-testid="swr-user">{`swr: ${data?.name ?? "none"}`}</p>;
}
