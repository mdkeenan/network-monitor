import { test, expect } from "@playwright/test";

test.describe("dashboard grid edit", () => {
  test("customize dialog opens grid edit mode", async ({ page }) => {
    await page.goto("/");
    await page.locator("#customize-dashboard-btn").click();

    const widgetSettings = page.locator("#widget-settings");
    await expect(widgetSettings).toBeVisible();

    await page.locator("#widget-grid-edit-btn").click();

    await expect(page.locator("#grid-edit-apply-btn")).toBeVisible();
    await expect(page.locator("#grid-edit-cancel-btn")).toBeVisible();
    await expect(page.locator("#dashboard")).toHaveClass(/grid-edit-mode/);

    await page.locator("#grid-edit-cancel-btn").click();
    await expect(page.locator("#dashboard")).not.toHaveClass(/grid-edit-mode/);
  });
});
