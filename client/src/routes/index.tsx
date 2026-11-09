import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Dices, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api";

type GameSearch = {
  q?: string;
  expansions?: true;
  available?: true;
  page?: number;
};

const SEARCH_DELAY_MS = 300;

export const Route = createFileRoute("/")({
  // Leave out default values, so that shared URLs stay short.
  validateSearch: (search: Record<string, unknown>): GameSearch => ({
    q: typeof search.q === "string" && search.q.trim() !== "" ? search.q.trim() : undefined,
    expansions: search.expansions === true || search.expansions === "true" ? true : undefined,
    available: search.available === true || search.available === "true" ? true : undefined,
    page:
      Number.isInteger(search.page) && Number(search.page) > 1 ? Number(search.page) : undefined,
  }),
  component: GameSearchPage,
});

function GameSearchPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [searchText, setSearchText] = useState(search.q ?? "");

  // Follow the URL when it changes from outside the text box, for example on "Back".
  useEffect(() => {
    setSearchText((current) => (current.trim() === (search.q ?? "") ? current : (search.q ?? "")));
  }, [search.q]);

  useEffect(() => {
    const q = searchText.trim() || undefined;
    if (q === search.q) return;
    const timer = setTimeout(() => {
      navigate({ search: (previous) => ({ ...previous, q, page: undefined }), replace: true });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchText, search.q, navigate]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Where to Play</h1>
        <p className="text-muted-foreground">
          Find a board game, then see the cafes and conventions that have it.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search for a board game"
            placeholder="Search for a board game"
            className="h-11 pl-9 text-base"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            autoFocus
          />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <FilterSwitch
            id="available"
            label="Only games I can play somewhere"
            checked={search.available === true}
            onCheckedChange={(checked) =>
              navigate({
                search: (previous) => ({
                  ...previous,
                  available: checked || undefined,
                  page: undefined,
                }),
              })
            }
          />
          <FilterSwitch
            id="expansions"
            label="Include expansions"
            checked={search.expansions === true}
            onCheckedChange={(checked) =>
              navigate({
                search: (previous) => ({
                  ...previous,
                  expansions: checked || undefined,
                  page: undefined,
                }),
              })
            }
          />
        </div>
      </div>

      {search.q ? <SearchResults search={{ ...search, q: search.q }} /> : null}
    </main>
  );
}

function FilterSwitch(props: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={props.id} checked={props.checked} onCheckedChange={props.onCheckedChange} />
      <Label htmlFor={props.id}>{props.label}</Label>
    </div>
  );
}

function SearchResults({ search }: { search: GameSearch & { q: string } }) {
  const navigate = useNavigate({ from: Route.fullPath });
  const page = search.page ?? 1;
  const games = useQuery({
    queryKey: ["games", search.q, search.expansions, search.available, page],
    queryFn: async () => {
      const response = await apiClient.api.games.$get({
        query: {
          q: search.q,
          expansions: search.expansions,
          available: search.available,
          page,
        },
      });
      if (!response.ok) throw new Error(`Game search failed with status ${response.status}`);
      return response.json();
    },
    placeholderData: keepPreviousData,
  });

  if (games.isPending) {
    return (
      <ul className="flex flex-col gap-2" aria-label="Loading results">
        {Array.from({ length: 5 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
          <li key={index} className="flex items-center gap-4 rounded-lg p-2">
            <Skeleton className="size-16 rounded-md" />
            <Skeleton className="h-5 w-48" />
          </li>
        ))}
      </ul>
    );
  }

  if (games.isError) {
    return (
      <p role="alert" className="text-center text-destructive">
        The search did not work. BoardGameGeek can be slow, so try again in a moment.
      </p>
    );
  }

  const { results, total, pageSize } = games.data;
  if (results.length === 0) {
    return (
      <p className="text-center text-muted-foreground">
        No games match “{search.q}”{search.available ? " in the collections we know about" : ""}.
      </p>
    );
  }

  const pageCount = Math.ceil(total / pageSize);
  const goToPage = (newPage: number) =>
    navigate({ search: (previous) => ({ ...previous, page: newPage > 1 ? newPage : undefined }) });

  return (
    <section className="flex flex-col gap-4" aria-busy={games.isPlaceholderData}>
      <p className="text-sm text-muted-foreground">{total === 1 ? "1 game" : `${total} games`}</p>
      <ul className="flex flex-col gap-1">
        {results.map((game) => (
          <li key={game.bggId}>
            <Link
              to="/games/$bggId"
              params={{ bggId: String(game.bggId) }}
              className="flex items-center gap-4 rounded-lg p-2 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            >
              <Thumbnail url={game.thumbnailUrl} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate font-medium">
                  {game.name}
                  {game.yearPublished ? (
                    <span className="font-normal text-muted-foreground">
                      {` (${game.yearPublished})`}
                    </span>
                  ) : null}
                </span>
                <span className="flex flex-wrap gap-1">
                  {game.isExpansion ? <Badge variant="outline">Expansion</Badge> : null}
                  {game.collectionCount > 0 ? (
                    <Badge>
                      {game.collectionCount === 1
                        ? "At 1 place"
                        : `At ${game.collectionCount} places`}
                    </Badge>
                  ) : null}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {pageCount > 1 ? (
        <nav className="flex items-center justify-between" aria-label="Pages">
          <Button variant="outline" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {pageCount}
          </span>
          <Button variant="outline" disabled={page >= pageCount} onClick={() => goToPage(page + 1)}>
            Next
          </Button>
        </nav>
      ) : null}
    </section>
  );
}

function Thumbnail({ url }: { url: string | null }) {
  if (!url) {
    return (
      <div className="flex size-16 shrink-0 items-center justify-center rounded-md bg-muted">
        <Dices className="size-6 text-muted-foreground" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      className="size-16 shrink-0 rounded-md bg-muted object-contain"
    />
  );
}
