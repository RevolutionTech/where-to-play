import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

const REQUEST_COLLECTION_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSeHI7dHt4y1ZyuO1WPnh8zQaZZTTQku1L92HOzWf9hUtjo_Tg/viewform";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <div className="flex min-h-screen flex-col border-t-4 border-brand-teal bg-background text-foreground">
      <div className="flex-1">
        <Outlet />
      </div>
      <footer className="flex flex-col items-center gap-4 border-t px-4 py-6 text-center">
        <p className="text-sm text-muted-foreground">
          Know a cafe or convention that is missing?{" "}
          <a
            href={REQUEST_COLLECTION_FORM_URL}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-brand-teal underline underline-offset-4"
          >
            Request a collection
          </a>
        </p>
        {/* BGG's API terms require this logo, linked to BGG, on public apps. */}
        <a href="https://boardgamegeek.com" target="_blank" rel="noreferrer">
          <img src="/powered-by-bgg.svg" alt="Powered by BGG" className="h-9 w-auto" />
        </a>
      </footer>
    </div>
  ),
});
