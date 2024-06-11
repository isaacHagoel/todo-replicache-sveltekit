import { expect, test } from '@playwright/test';

test('home page has expected have footer', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('footer')).toBeVisible();
});
