/**
 * Optional HTML fetch via headless Chromium for JS-rendered pages.
 * Requires: pnpm playwright:install (Chromium).
 */
export async function fetchHtmlWithPlaywright(url: string): Promise<string | null> {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 18000 });
      await new Promise<void>(r => setTimeout(r, 900));
      return await page.content();
    } finally {
      await browser.close();
    }
  } catch {
    return null;
  }
}
