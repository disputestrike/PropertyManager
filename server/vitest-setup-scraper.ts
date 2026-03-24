/** Scraper integration tests need permissive size rules (live OSM rarely has 100k+ tagged). */
process.env.SCRAPER_MIN_SQFT = "0";
process.env.SCRAPER_INCLUDE_UNKNOWN_SIZE = "1";
