import { useState, type ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
  QueryCache,
  MutationCache,
} from "@tanstack/react-query";

/**
 * Sets up the QueryClientProvider from TanStack Query.
 * @desc See: https://tanstack.com/query/v5/docs/framework/react/reference/QueryClientProvider
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  // Keep the same client (and its cache) across re-renders.
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache(),
        mutationCache: new MutationCache(),
      })
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
