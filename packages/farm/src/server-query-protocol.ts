export const FARM_SERVER_QUERY_RESULT_VERSION = 1 as const;

export type FarmServerQueryResult<TData> = {
  __farmServerQuery: {
    version: typeof FARM_SERVER_QUERY_RESULT_VERSION;
    key: string;
    staleTime: number | false;
    updatedAt: number;
  };
  data: TData;
};

export function createFarmServerQueryResult<TData>(
  data: TData,
  metadata: Omit<FarmServerQueryResult<TData>["__farmServerQuery"], "version">,
): FarmServerQueryResult<TData> {
  return {
    __farmServerQuery: {
      version: FARM_SERVER_QUERY_RESULT_VERSION,
      ...metadata,
    },
    data,
  };
}

export function isFarmServerQueryResult(value: unknown): value is FarmServerQueryResult<unknown> {
  if (!value || typeof value !== "object") return false;

  const metadata = (value as Partial<FarmServerQueryResult<unknown>>).__farmServerQuery;
  return (
    metadata?.version === FARM_SERVER_QUERY_RESULT_VERSION &&
    typeof metadata.key === "string" &&
    (metadata.staleTime === false || typeof metadata.staleTime === "number") &&
    typeof metadata.updatedAt === "number" &&
    "data" in value
  );
}
