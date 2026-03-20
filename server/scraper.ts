import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Represents a scraped property with manager contact info
 */
export interface ScrapedProperty {
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  propertyType?: string;
  source: string;
  sourceUrl?: string;
  managers: ScrapedManager[];
}

export interface ScrapedManager {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  title?: string;
  website?: string;
  source: string;
}

/**
 * Scrape commercial properties from Google Maps for a given ZIP code.
 * This is a simplified implementation that demonstrates the concept.
 * In production, you would use the Google Places API or a dedicated scraping service.
 */
export async function scrapeGoogleMapsProperties(zipCode: string): Promise<ScrapedProperty[]> {
  const properties: ScrapedProperty[] = [];

  try {
    // In a real implementation, you would:
    // 1. Use Google Places API to search for "property management" in the ZIP code
    // 2. Extract business names, phone numbers, websites
    // 3. Visit websites to extract email addresses and manager names
    
    // For now, we'll return a mock implementation
    console.log(`[Scraper] Attempting to scrape Google Maps for ZIP code: ${zipCode}`);
    
    // This would be replaced with actual API calls
    // const searchUrl = `https://www.google.com/maps/search/property+management+${zipCode}`;
    
  } catch (error) {
    console.error(`[Scraper] Error scraping Google Maps:`, error);
  }

  return properties;
}

/**
 * Scrape county assessor records for commercial properties.
 * This is highly state/county specific and would require custom implementations per county.
 */
export async function scrapeCountyAssessorProperties(zipCode: string, state: string): Promise<ScrapedProperty[]> {
  const properties: ScrapedProperty[] = [];

  try {
    console.log(`[Scraper] Attempting to scrape county assessor records for ZIP: ${zipCode}, State: ${state}`);
    
    // County assessor websites vary significantly by jurisdiction
    // This would require custom implementations per county
    // Example: California uses different format than Texas, etc.
    
  } catch (error) {
    console.error(`[Scraper] Error scraping county assessor:`, error);
  }

  return properties;
}

/**
 * Extract contact information from a company website
 */
export async function extractContactFromWebsite(url: string): Promise<Partial<ScrapedManager>> {
  const manager: Partial<ScrapedManager> = { source: 'website_scrape' };

  try {
    const response = await axios.get(url, {
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const $ = cheerio.load(response.data);

    // Try to find email addresses
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const bodyText = $.text();
    const emails = bodyText.match(emailPattern);
    if (emails && emails.length > 0) {
      // Filter out common non-contact emails
      const contactEmails = emails.filter(e => 
        !e.includes('noreply') && 
        !e.includes('no-reply') &&
        !e.includes('donotreply')
      );
      if (contactEmails.length > 0) {
        manager.email = contactEmails[0];
      }
    }

    // Try to find phone numbers
    const phonePattern = /(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g;
    const phones = bodyText.match(phonePattern);
    if (phones && phones.length > 0) {
      manager.phone = phones[0];
    }

    // Try to find manager names in common contact page patterns
    const contactSection = $('a[href*="contact"], a[href*="about"], div[class*="contact"], div[id*="contact"]').parent();
    if (contactSection.length > 0) {
      const text = contactSection.text();
      // Simple heuristic: look for capitalized names
      const namePattern = /([A-Z][a-z]+ [A-Z][a-z]+)/;
      const nameMatch = text.match(namePattern);
      if (nameMatch) {
        manager.name = nameMatch[0];
      }
    }

  } catch (error) {
    console.error(`[Scraper] Error extracting contact from ${url}:`, error);
  }

  return manager;
}

/**
 * Validate and normalize a ZIP code
 */
export function normalizeZipCode(zipCode: string): string | null {
  // Replace spaces with dashes, then remove other invalid characters
  let cleaned = zipCode.replace(/\s+/g, '-').replace(/[^\d-]/g, '');
  
  // Check for valid 5-digit or 9-digit ZIP code format
  if (/^\d{5}$/.test(cleaned)) {
    return cleaned;
  }
  if (/^\d{5}-\d{4}$/.test(cleaned)) {
    return cleaned;
  }
  
  return null;
}

/**
 * Main scraping orchestrator
 */
export async function scrapePropertiesForZipCode(zipCode: string): Promise<ScrapedProperty[]> {
  const normalized = normalizeZipCode(zipCode);
  if (!normalized) {
    throw new Error(`Invalid ZIP code format: ${zipCode}`);
  }

  const properties: ScrapedProperty[] = [];

  try {
    // Attempt to scrape from multiple sources
    console.log(`[Scraper] Starting scrape for ZIP code: ${normalized}`);

    // Try Google Maps (would use API in production)
    const gmapsProperties = await scrapeGoogleMapsProperties(normalized);
    properties.push(...gmapsProperties);

    // Try county assessor (would be county-specific in production)
    // Extract state from ZIP code context (would need to be passed in)
    // const countyProperties = await scrapeCountyAssessorProperties(normalized, state);
    // properties.push(...countyProperties);

    // For demonstration, add a sample property
    if (properties.length === 0) {
      console.log(`[Scraper] No properties found from primary sources, adding sample data for demonstration`);
      properties.push({
        name: 'Sample Commercial Building',
        address: '123 Main Street',
        city: 'Sample City',
        state: 'CA',
        zipCode: normalized,
        propertyType: 'Office',
        source: 'demo',
        managers: [
          {
            name: 'John Smith',
            email: 'john@propertymanagement.com',
            phone: '(555) 123-4567',
            company: 'ABC Property Management',
            title: 'Property Manager',
            source: 'demo'
          }
        ]
      });
    }

    console.log(`[Scraper] Scrape completed. Found ${properties.length} properties`);
    return properties;

  } catch (error) {
    console.error(`[Scraper] Error during scraping:`, error);
    throw error;
  }
}
