# Commercial Property Scraper - TODO

## Core Features
- [x] Database schema for properties, property managers, scraping jobs, and job results
- [x] Backend scraping logic to extract data from Google Maps and county assessor sites
- [x] tRPC procedures for initiating scrapes and retrieving results
- [x] ZIP code input form with validation
- [x] Results table with searchable/sortable columns
- [x] CSV export functionality
- [x] Loading states and error handling for scraping operations
- [ ] Data enrichment from additional sources (emails, phone numbers) - future enhancement
- [x] Owner notification system when scraping completes
- [x] Scraping job history and tracking in database
- [x] Frontend UI for viewing past scraping jobs

## Technical Setup
- [x] Install scraping dependencies (cheerio, axios, or similar)
- [x] Configure environment variables for external APIs
- [x] Set up database migrations

## Testing
- [x] Test scraping with sample ZIP codes
- [x] Verify CSV export functionality
- [x] Test email notifications
- [x] Verify data storage and retrieval

## Deployment Ready
- [x] Code review and cleanup
- [ ] Final checkpoint before publishing
