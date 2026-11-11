import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp, stubApi } from "@/test/render-app";

afterEach(() => {
  vi.unstubAllGlobals();
});

function game(bggId: number, name: string, extra: Record<string, unknown> = {}) {
  return {
    bggId,
    name,
    yearPublished: 1995,
    isExpansion: false,
    thumbnailUrl: `https://cf.geekdo-images.com/${bggId}-thumb.jpg`,
    placeCount: 0,
    ...extra,
  };
}

function searchResponse(results: ReturnType<typeof game>[], total = results.length, page = 1) {
  return Response.json({ total, page, pageSize: 20, results });
}

describe("game search page", () => {
  it("searches as the user types, and lists each game with a thumbnail", async () => {
    const requests = stubApi(() =>
      searchResponse([
        game(13, "Catan", { placeCount: 2 }),
        game(2807, "Catan Junior", { yearPublished: 2011 }),
      ]),
    );
    const router = renderApp("/");

    fireEvent.change(await screen.findByRole("searchbox", { name: "Search for a board game" }), {
      target: { value: "catan" },
    });

    const catan = await screen.findByRole("link", { name: /^Catan.*1995/ });
    expect(within(catan).getByText("At 2 places")).toBeInTheDocument();
    expect(catan.querySelector("img")).toHaveAttribute(
      "src",
      "https://cf.geekdo-images.com/13-thumb.jpg",
    );
    expect(catan).toHaveAttribute("href", "/games/13");
    expect(screen.getByRole("link", { name: /^Catan Junior.*2011/ })).toBeInTheDocument();
    expect(screen.getByText("2 games")).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ q: "catan" });
    expect(requests.map((url) => url.searchParams.get("q"))).toEqual(["catan"]);
  });

  it("runs the search in the URL when the page opens", async () => {
    const requests = stubApi(() => searchResponse([game(13, "Catan")]));

    renderApp("/?q=catan&available=true");

    expect(await screen.findByRole("link", { name: /^Catan/ })).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("catan");
    expect(screen.getByRole("switch", { name: "Only games in a collection" })).toBeChecked();
    expect(requests[0]?.searchParams.get("available")).toBe("true");
  });

  it("searches again with expansions when the user turns on the filter", async () => {
    const requests = stubApi(() => searchResponse([game(13, "Catan")]));
    renderApp("/?q=catan");
    await screen.findByRole("link", { name: /^Catan/ });

    fireEvent.click(screen.getByRole("switch", { name: "Include expansions" }));

    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0]?.searchParams.get("expansions")).toBeNull();
    expect(requests[1]?.searchParams.get("expansions")).toBe("true");
  });

  it("moves to the next page of results", async () => {
    const requests = stubApi((url) =>
      url.searchParams.get("page") === "2"
        ? searchResponse([game(21, "Dungeon 21")], 21, 2)
        : searchResponse([game(1, "Dungeon 01")], 21, 1),
    );
    renderApp("/?q=dungeon");
    expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("link", { name: /^Dungeon 21/ })).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(requests.map((url) => url.searchParams.get("page"))).toEqual(["1", "2"]);
  });

  it("says when no games match", async () => {
    stubApi(() => searchResponse([]));

    renderApp("/?q=zzzz");

    expect(await screen.findByText("No games match “zzzz”.")).toBeInTheDocument();
  });

  it("says when the search fails", async () => {
    stubApi(() => Response.json({ error: "BoardGameGeek is not available." }, { status: 502 }));

    renderApp("/?q=catan");

    expect(await screen.findByRole("alert")).toHaveTextContent("The search did not work.");
  });

  it("sends no request before the user types", async () => {
    const requests = stubApi(() => searchResponse([]));

    renderApp("/");

    expect(await screen.findByRole("heading", { name: "Where to Play" })).toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  it("credits BoardGameGeek with a link to it", async () => {
    stubApi(() => searchResponse([]));

    renderApp("/");

    const credit = await screen.findByRole("link", { name: "Powered by BGG" });
    expect(credit).toHaveAttribute("href", "https://boardgamegeek.com");
  });
});
