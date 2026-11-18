import { useAuthenticatedFetch } from "./useAuthenticatedFetch";
import { useMemo } from "react";
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

interface AppQueryOptions<TData> {
  url: string;
  fetchInit?: RequestInit;
  reactQueryOptions?: Omit<UseQueryOptions<TData>, "queryKey" | "queryFn">;
}

/**
 * A hook for querying your custom app data.
 * @desc A thin wrapper around useAuthenticatedFetch and react-query's useQuery.
 *
 * @param {Object} options - The options for your query. Accepts 3 keys:
 *
 * 1. url: The URL to query. E.g: /api/widgets/1`
 * 2. fetchInit: The init options for fetch.  See: https://developer.mozilla.org/en-US/docs/Web/API/fetch#parameters
 * 3. reactQueryOptions: The options for `useQuery`. See: https://tanstack.com/query/v5/docs/framework/react/reference/useQuery
 *
 * @returns Return value of useQuery.  See: https://tanstack.com/query/v5/docs/framework/react/reference/useQuery
 */
export const useAppQuery = <TData = unknown>({
  url,
  fetchInit = {},
  reactQueryOptions,
}: AppQueryOptions<TData>) => {
  const authenticatedFetch = useAuthenticatedFetch();
  const fetch = useMemo(() => {
    return async (): Promise<TData> => {
      const response = await authenticatedFetch(url, fetchInit);
      return response.json();
    };
  }, [url, JSON.stringify(fetchInit)]);

  return useQuery<TData>({
    queryKey: [url],
    queryFn: fetch,
    ...reactQueryOptions,
    refetchOnWindowFocus: false,
  });
};
