import { test, expect } from "@playwright/test";

test.describe("ConnectWatch dashboard", () => {
  test("loads with title and summary cards", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("ConnectWatch");
    await expect(page.locator("h1")).toHaveText("ConnectWatch");
    await expect(page.locator("#widget-summary-cards")).toBeVisible();
    await expect(page.locator("#widget-line-chart")).toBeVisible();
  });

  test("status API returns JSON", async ({ request }) => {
    const response = await request.get("/api/status");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toBeTruthy();
    expect(typeof body).toBe("object");
  });

  test("settings dialog opens", async ({ page }) => {
    await page.goto("/");
    await page.locator("#settings-btn").click();
    const dialog = page.locator("#settings-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".app-settings-header")).toBeVisible();
  });
});
