import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { createAppRouter } from "@/router";

export function renderApp(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [url] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

/** Stubs fetch. Returns the URLs of the requests, so tests can check what the page asked for. */
export function stubApi(respond: (url: URL) => Response) {
  const requests: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost");
      requests.push(url);
      return respond(url);
    }),
  );
  return requests;
}
