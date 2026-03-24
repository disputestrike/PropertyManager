export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  /** Optional: https://docs.developer.yelp.com/docs/fusion-intro */
  yelpApiKey: process.env.YELP_API_KEY ?? "",
  /**
   * Set PLAYWRIGHT_ENRICH=1 after `pnpm playwright:install` to render JS-heavy sites
   * when extracting contacts (slower, optional).
   */
  playwrightEnrich: process.env.PLAYWRIGHT_ENRICH === "1",
  /** Best-effort LoopNet search + listing page parse (often blocked; optional). */
  loopnetEnrich: process.env.SCRAPER_LOOPNET_ENRICH === "1",
  /** Azure Bing Web Search v7 key — enriches from search snippets + fetched result pages. */
  bingSearchApiKey: process.env.BING_SEARCH_API_KEY ?? "",
};
