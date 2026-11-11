import { expect, test } from "@playwright/test";

// The fake BGG (e2e/fake-bgg.ts) knows these games. The E2E database says which collections own
// them: KublaCon and The Game Parlour own Catan, and no collection owns the others.
const catan = "search-result-13";
const catanSeafarers = "search-result-325";
const catanJunior = "search-result-2807";

test("a search shows the matching games and how many places have each one", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("searchbox", { name: "Search for a board game" }).fill("Catan");

  await expect(page.getByText("2 games")).toBeVisible();
  await expect(page.getByTestId(catan)).toContainText("Catan (1995)");
  await expect(page.getByTestId(catan)).toContainText("At 3 places");
  await expect(page.getByTestId(catanJunior)).toContainText("Catan Junior (2011)");
  await expect(page.getByTestId(catanJunior)).not.toContainText("place");
  await expect(page.getByTestId(catanSeafarers)).toHaveCount(0);
});

test("the expansions filter adds expansions to the results", async ({ page }) => {
  await page.goto("/?q=Catan");
  await expect(page.getByText("2 games")).toBeVisible();

  await page.getByRole("switch", { name: "Include expansions" }).click();

  await expect(page.getByText("3 games")).toBeVisible();
  await expect(page.getByTestId(catanSeafarers)).toContainText("Expansion");
});

test("the available filter keeps only games that some place has", async ({ page }) => {
  await page.goto("/?q=Catan");
  await expect(page.getByText("2 games")).toBeVisible();

  await page.getByRole("switch", { name: "Only games in a collection" }).click();

  await expect(page.getByText("1 game", { exact: true })).toBeVisible();
  await expect(page.getByTestId(catan)).toBeVisible();
  await expect(page.getByTestId(catanJunior)).toHaveCount(0);
});

test("a shared search URL shows the same filtered results", async ({ page }) => {
  await page.goto("/?q=Catan&available=true");

  await expect(page.getByRole("searchbox", { name: "Search for a board game" })).toHaveValue(
    "Catan",
  );
  await expect(page.getByRole("switch", { name: "Only games in a collection" })).toBeChecked();
  await expect(page.getByText("1 game", { exact: true })).toBeVisible();
  await expect(page.getByTestId(catan)).toBeVisible();
});

test("a game page lists the places that have the game", async ({ page }) => {
  await page.goto("/?q=Catan");

  await page.getByTestId(catan).getByRole("link").click();

  await expect(page.getByRole("heading", { name: "Catan", level: 1 })).toBeVisible();
  await expect(page.getByTestId("collection-kublacon")).toContainText("KublaCon");
  await expect(page.getByTestId("collection-the-game-parlour")).toContainText("The Game Parlour");
  await expect(page.getByTestId("collection-adventurers-guild")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Board Game Arena" })).toHaveAttribute(
    "href",
    "https://boardgamearena.com/",
  );
});
