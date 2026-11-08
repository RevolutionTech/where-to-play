import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { apiClient } from "@/lib/api";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const response = await apiClient.api.health.$get();
      if (!response.ok) throw new Error(`Health check failed with status ${response.status}`);
      return response.json();
    },
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Where to Play</h1>
      <p className="text-lg text-muted-foreground">Coming soon.</p>
      <p className="text-sm text-muted-foreground">
        API status:{" "}
        {health.isPending ? "checking…" : health.isError ? "unreachable" : health.data.status}
      </p>
    </main>
  );
}
