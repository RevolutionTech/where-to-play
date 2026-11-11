import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp, stubApi } from "@/test/render-app";

afterEach(() => {
  vi.unstubAllGlobals();
});

const catan = {
  bggId: 13,
  name: "Catan",
  yearPublished: 1995,
  description: "Trade and build.",
  minPlayers: 3,
  maxPlayers: 4,
  minPlaytimeMinutes: 60,
  maxPlaytimeMinutes: 120,
  bggRating: 7.08,
  bggRank: 575,
  imageUrl: "https://cf.geekdo-images.com/13.jpg",
  bggUrl: "https://boardgamegeek.com/boardgame/13",
  collections: [
    { slug: "kublacon", name: "KublaCon", kind: "convention", websiteUrl: null, location: null },
    {
      slug: "the-game-parlour",
      name: "The Game Parlour",
      kind: "cafe",
      websiteUrl: "https://gameparlour.example",
      location: "San Francisco, CA",
    },
  ],
  digitalImplementations: [],
};

describe("game details page", () => {
  it("shows the game, the collections that own it, and a link to BGG", async () => {
    const requests = stubApi(() => Response.json(catan));

    renderApp("/games/13");

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Catan (1995)");
    expect(screen.getByText("3–4")).toBeInTheDocument();
    expect(screen.getByText("60–120 min")).toBeInTheDocument();
    expect(screen.getByText("7.1")).toBeInTheDocument();
    expect(screen.getByText("#575")).toBeInTheDocument();
    expect(screen.getByText("Trade and build.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Box art for Catan" })).toHaveAttribute(
      "src",
      "https://cf.geekdo-images.com/13.jpg",
    );
    expect(screen.getByRole("link", { name: "View on BoardGameGeek" })).toHaveAttribute(
      "href",
      "https://boardgamegeek.com/boardgame/13",
    );

    const collectionList = screen.getByRole("list");
    const items = within(collectionList).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "KublaConConvention",
      "The Game ParlourCafeSan Francisco, CA",
    ]);
    expect(within(collectionList).getByRole("link", { name: "The Game Parlour" })).toHaveAttribute(
      "href",
      "https://gameparlour.example",
    );
    expect(requests.map((url) => url.pathname)).toEqual(["/api/games/13"]);
  });

  it("lists digital implementations after the collections, with links to known platforms", async () => {
    stubApi(() =>
      Response.json({ ...catan, digitalImplementations: ["Board Game Arena", "Boardgamecore"] }),
    );

    renderApp("/games/13");

    const collectionList = await screen.findByRole("list");
    const items = within(collectionList).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "KublaConConvention",
      "The Game ParlourCafeSan Francisco, CA",
      "Board Game ArenaDigital",
      "BoardgamecoreDigital",
    ]);
    expect(within(collectionList).getByRole("link", { name: "Board Game Arena" })).toHaveAttribute(
      "href",
      "https://boardgamearena.com/",
    );
    expect(within(collectionList).queryByRole("link", { name: "Boardgamecore" })).toBeNull();
  });

  it("says when no collection owns the game", async () => {
    stubApi(() => Response.json({ ...catan, collections: [] }));

    renderApp("/games/13");

    expect(
      await screen.findByText("No collections that we know of have this game."),
    ).toBeInTheDocument();
  });

  it("lists only digital implementations when no collection owns the game", async () => {
    stubApi(() => Response.json({ ...catan, collections: [], digitalImplementations: ["Steam"] }));

    renderApp("/games/13");

    expect(await screen.findByRole("link", { name: "Steam" })).toHaveAttribute(
      "href",
      "https://store.steampowered.com/",
    );
    expect(screen.queryByText("No collections that we know of have this game.")).toBeNull();
  });

  it("says when the game does not exist", async () => {
    stubApi(() => Response.json({ error: "Game not found." }, { status: 404 }));

    renderApp("/games/999999");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not find this game on BoardGameGeek.",
    );
  });

  it("says when the game does not load", async () => {
    stubApi(() => Response.json({ error: "BoardGameGeek is not available." }, { status: 502 }));

    renderApp("/games/13");

    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent(
      "This game did not load.",
    );
  });
});
