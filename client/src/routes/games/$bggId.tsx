import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { InferResponseType } from "hono/client";
import {
  Clock,
  Coffee,
  ExternalLink,
  House,
  type LucideIcon,
  Star,
  Ticket,
  Trophy,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient } from "@/lib/api";

export const Route = createFileRoute("/games/$bggId")({
  component: GameDetailsPage,
});

class GameNotFoundError extends Error {}

type CollectionKind = GameDetailsResponse["collections"][number]["kind"];

const collectionKinds: Record<
  CollectionKind,
  { label: string; icon: LucideIcon; badgeClassName: string }
> = {
  cafe: { label: "Cafe", icon: Coffee, badgeClassName: "bg-cafe text-cafe-foreground" },
  convention: {
    label: "Convention",
    icon: Ticket,
    badgeClassName: "bg-convention text-convention-foreground",
  },
  individual: {
    label: "Personal collection",
    icon: House,
    badgeClassName: "bg-individual text-individual-foreground",
  },
};

function GameDetailsPage() {
  const { bggId } = Route.useParams();
  const game = useQuery({
    queryKey: ["game", bggId],
    queryFn: async () => {
      const response = await apiClient.api.games[":bggId"].$get({ param: { bggId } });
      if (response.status === 404) throw new GameNotFoundError();
      if (!response.ok) throw new Error(`Game request failed with status ${response.status}`);
      return response.json();
    },
    // A missing game stays missing, so only retry other errors.
    retry: (failureCount, error) => !(error instanceof GameNotFoundError) && failureCount < 1,
  });

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
      <Link
        to="/"
        className="flex w-fit items-center gap-2 text-lg font-bold tracking-tight text-brand-navy"
      >
        <img src="/logo.png" alt="" className="size-9" />
        Where to Play
      </Link>
      {game.isPending ? (
        <div className="flex flex-col gap-4" role="status" aria-label="Loading game">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : game.isError ? (
        <p role="alert" className="text-destructive">
          {game.error instanceof GameNotFoundError
            ? "We could not find this game on BoardGameGeek."
            : "This game did not load. BoardGameGeek can be slow, so try again in a moment."}
        </p>
      ) : (
        <GameDetails game={game.data} />
      )}
    </main>
  );
}

type GameDetailsResponse = InferResponseType<(typeof apiClient.api.games)[":bggId"]["$get"], 200>;

function GameDetails({ game }: { game: GameDetailsResponse }) {
  const players = formatRange(game.minPlayers, game.maxPlayers);
  const playtime = formatRange(game.minPlaytimeMinutes, game.maxPlaytimeMinutes);

  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-6 sm:flex-row">
        {game.imageUrl ? (
          <img
            src={game.imageUrl}
            alt={`Box art for ${game.name}`}
            className="max-h-64 w-full rounded-lg bg-muted object-contain sm:w-56"
          />
        ) : null}
        <div className="flex flex-col gap-4">
          <h1 className="text-3xl font-bold tracking-tight">
            {game.name}
            {game.yearPublished ? (
              <span className="font-normal text-muted-foreground">{` (${game.yearPublished})`}</span>
            ) : null}
          </h1>
          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {players ? (
              <Fact icon={<Users />} label="Players">
                {players}
              </Fact>
            ) : null}
            {playtime ? (
              <Fact icon={<Clock />} label="Playtime">
                {playtime} min
              </Fact>
            ) : null}
            {game.bggRating ? (
              <Fact icon={<Star />} label="BGG rating">
                {game.bggRating.toFixed(1)}
              </Fact>
            ) : null}
            {game.bggRank ? (
              <Fact icon={<Trophy />} label="BGG rank">
                #{game.bggRank}
              </Fact>
            ) : null}
          </dl>
          <a
            href={game.bggUrl}
            target="_blank"
            rel="noreferrer"
            className="flex w-fit items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            View on BoardGameGeek
            <ExternalLink className="size-4" />
          </a>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Where to play it</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {game.collections.length === 0 ? (
            <p className="text-muted-foreground">No collections that we know of have this game.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {game.collections.map((collection) => (
                <li
                  key={collection.slug}
                  data-testid={`collection-${collection.slug}`}
                  className="flex flex-wrap items-center gap-2"
                >
                  {collection.websiteUrl ? (
                    <a
                      href={collection.websiteUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {collection.name}
                    </a>
                  ) : (
                    <span className="font-medium">{collection.name}</span>
                  )}
                  <CollectionKindBadge kind={collection.kind} />
                  {collection.location ? (
                    <span className="text-sm text-muted-foreground">{collection.location}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {game.description ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">About the game</h2>
          <p className="whitespace-pre-line text-muted-foreground">{game.description}</p>
        </section>
      ) : null}
    </article>
  );
}

function CollectionKindBadge({ kind }: { kind: CollectionKind }) {
  const { label, icon: Icon, badgeClassName } = collectionKinds[kind];
  return (
    <Badge className={badgeClassName}>
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}

function Fact(props: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-brand-teal [&>svg]:size-4" aria-hidden>
        {props.icon}
      </span>
      <dt className="sr-only">{props.label}</dt>
      <dd>{props.children}</dd>
    </div>
  );
}

function formatRange(min: number | null, max: number | null) {
  if (min && max && min !== max) return `${min}–${max}`;
  return min || max ? String(min || max) : null;
}
