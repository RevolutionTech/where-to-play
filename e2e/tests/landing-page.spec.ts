import { expect, test } from "@playwright/test";

test("shows the app name and that the API can reach the database", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Where to Play" })).toBeVisible();
  await expect(page.getByTestId("api-status")).toHaveText("API status: ok");
});
