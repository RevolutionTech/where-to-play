import { expect, test } from "@playwright/test";

test("shows the app name and the game search box", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Where to Play" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search for a board game" })).toBeFocused();
});

test("reaches the database through the client's API proxy", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok", database: "ok" });
});
