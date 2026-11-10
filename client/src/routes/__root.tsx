import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <div className="flex min-h-screen flex-col border-t-4 border-brand-teal bg-background text-foreground">
      <div className="flex-1">
        <Outlet />
      </div>
      <footer className="flex justify-center border-t px-4 py-6">
        {/* BGG's API terms require this logo, linked to BGG, on public apps. */}
        <a href="https://boardgamegeek.com" target="_blank" rel="noreferrer">
          <img src="/powered-by-bgg.svg" alt="Powered by BGG" className="h-9 w-auto" />
        </a>
      </footer>
    </div>
  ),
});
