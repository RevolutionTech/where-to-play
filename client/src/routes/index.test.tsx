import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppRouter } from "@/router";

function renderLandingPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: ["/"] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("landing page", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the app name and that the API is up", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ status: "ok" })),
    );

    renderLandingPage();

    expect(await screen.findByRole("heading", { name: "Where to Play" })).toBeInTheDocument();
    expect(await screen.findByText("API status: ok")).toBeInTheDocument();
  });

  it("shows that the API is unreachable when the health check fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );

    renderLandingPage();

    expect(await screen.findByText("API status: unreachable")).toBeInTheDocument();
  });
});
