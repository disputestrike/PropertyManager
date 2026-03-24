import axios from 'axios';
import * as cheerio from 'cheerio';
import { ENV } from './_core/env';
import { fetchHtmlWithPlaywright } from './_core/playwrightFetch';

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
  buildingSizeSqft?: number;
  buildingLevels?: number;
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
  linkedinUrl?: string;
  source: string;
}

type ZipLookupResponse = {
  places?: Array<{
    latitude?: string;
    longitude?: string;
    'place name'?: string;
    state?: string;
    'state abbreviation'?: string;
  }>;
};

type NominatimResponse = Array<{
  lat?: string;
  lon?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    postcode?: string;
  };
}>;

type OverpassElement = {
  id: number;
  type: 'node' | 'way' | 'relation';
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

type OverpassResponse = {
  elements?: OverpassElement[];
  /** Overpass may explain timeouts / incomplete results */
  remark?: string;
};

const ZIP_RESULT_CACHE_TTL_MS = 5 * 60 * 1000;
const zipResultCache = new Map<string, { expiresAt: number; properties: ScrapedProperty[] }>();
const inFlightScrapes = new Map<string, Promise<ScrapedProperty[]>>();

const JUNK_EMAIL = /(noreply|no-reply|donotreply|sentry|wixpress|squarespace|schema\.org)/i;

const HTTP_BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

/**
 * Default: no size cut at scrape time (filter in the UI). If SCRAPER_MIN_SQFT is set, unknown-size
 * rows are dropped unless SCRAPER_INCLUDE_UNKNOWN_SIZE=1 (same as before for power users).
 */
function readMinSqftScrapePolicy(): { min: number; includeUnknown: boolean } {
  const raw = process.env.SCRAPER_MIN_SQFT;
  let min = 0;
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) min = n;
  }
  if (min === 0) {
    return { min: 0, includeUnknown: true };
  }
  return {
    min,
    includeUnknown: process.env.SCRAPER_INCLUDE_UNKNOWN_SIZE === '1',
  };
}

function propertyMeetsMinSqft(p: ScrapedProperty, policy: { min: number; includeUnknown: boolean }): boolean {
  if (policy.min <= 0) return true;
  const sq = p.buildingSizeSqft;
  if (sq == null || Number.isNaN(Number(sq))) return policy.includeUnknown;
  return Number(sq) >= policy.min;
}

function filterPropertiesByMinSqft(
  properties: ScrapedProperty[],
  policy?: { min: number; includeUnknown: boolean }
): void {
  const p = policy ?? readMinSqftScrapePolicy();
  if (p.min <= 0) return;
  const before = properties.length;
  const kept = properties.filter(pr => propertyMeetsMinSqft(pr, p));
  properties.length = 0;
  properties.push(...kept);
  console.log(
    `[Scraper] Min sq ft ${p.min}${p.includeUnknown ? ' (unknown size allowed)' : ''}: kept ${kept.length} / ${before} properties`
  );
}

/**
 * Same-origin links whose path or anchor text looks like contact / team / leadership pages.
 */
export function discoverEnrichUrlsFromPage(html: string, pageUrl: string, maxUrls: number): string[] {
  const $ = cheerio.load(html);
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return [];
  }
  const keywordRe =
    /contact|about|team|leadership|management|staff|leasing|executive|directory|people|who-we|our-people|meet-the|officers|property|portfolio|connect|locations|visit/i;
  const out: string[] = [];
  const seen: Record<string, boolean> = {};

  $('a[href]').each((_, el) => {
    if (out.length >= maxUrls) return false;
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    let abs: string;
    try {
      abs = new URL(href, pageUrl).href.split('#')[0] ?? '';
    } catch {
      return;
    }
    if (!abs.startsWith(origin)) return;
    const path = new URL(abs).pathname.toLowerCase();
    const text = ($(el).text() || '').trim();
    if (!keywordRe.test(`${path} ${text}`)) return;
    if (seen[abs]) return;
    seen[abs] = true;
    out.push(abs);
    return undefined;
  });

  return out;
}

const TARGET_ROLE_PATTERNS = [
  /director of environmental services/i,
  /director of evs/i,
  /evs director/i,
  /facilities director/i,
  /director of facilities/i,
  /chief engineer/i,
  /building engineer/i,
  /superintendent/i,
  /portfolio manager/i,
  /general manager.*propert/i,
  /regional manager/i,
  /director of security/i,
  /security director/i,
  /director of operations/i,
  /operations director/i,
  /director of finance/i,
  /finance director/i,
  /concierge/i,
  /front desk/i,
  /maintenance manager/i,
  /building maintenance/i,
  /janitorial/i,
  /housekeeping director/i,
];

export function normalizeNameForMatch(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
}

/** Fuzzy match for merging Yelp rows into OSM properties */
export function namesLikelyMatch(a: string, b: string): boolean {
  const na = normalizeNameForMatch(a);
  const nb = normalizeNameForMatch(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) return true;
  const ta = new Set(
    a
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 2)
  );
  const tb = new Set(
    b
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 2)
  );
  let overlap = 0;
  for (const w of Array.from(ta)) if (tb.has(w)) overlap++;
  return overlap >= 2 || (overlap === 1 && ta.size <= 2 && tb.size <= 2);
}

type YelpBusiness = {
  id: string;
  name: string;
  phone?: string;
  display_phone?: string;
  url: string;
  location?: {
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    zip_code?: string;
  };
};

type YelpSearchResponse = { businesses?: YelpBusiness[] };

function scoreEmailCandidate(email: string): number {
  const lower = email.toLowerCase();
  let s = 0;
  if (/^(info|contact|hello|office|team|support|leasing|rentals|properties|pm|management)@/.test(lower)) s += 12;
  if (lower.includes('property') || lower.includes('rental')) s += 4;
  if (lower.includes('sales')) s -= 2;
  return s;
}

function pickBestEmail(emails: string[]): string | undefined {
  const good: string[] = [];
  for (const e of emails.map(x => x.trim()).filter(x => x && !JUNK_EMAIL.test(x))) {
    if (!good.includes(e)) good.push(e);
  }
  if (good.length === 0) return undefined;
  good.sort((a, b) => scoreEmailCandidate(b) - scoreEmailCandidate(a));
  return good[0];
}

function collectJsonLdObjects(raw: unknown): Record<string, unknown>[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) return raw.flatMap(collectJsonLdObjects);
  if (typeof raw !== 'object') return [];
  const o = raw as Record<string, unknown>;
  const out: Record<string, unknown>[] = [o];
  const graph = o['@graph'];
  if (Array.isArray(graph)) {
    for (const g of graph) out.push(...collectJsonLdObjects(g));
  }
  return out;
}

function normalizeLinkedInProfileUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const u = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    if (!/linkedin\.com$/i.test(u.hostname.replace(/^www\./, ''))) return undefined;
    if (!/\/in\//i.test(u.pathname)) return undefined;
    const path = u.pathname.split('?')[0]?.replace(/\/$/, '') ?? '';
    return `https://www.linkedin.com${path}`;
  } catch {
    return undefined;
  }
}

function extractContactFromJsonLd($: cheerio.CheerioAPI): {
  email?: string;
  phone?: string;
  linkedinUrl?: string;
} {
  const emails: string[] = [];
  const phones: string[] = [];
  let linkedinUrl: string | undefined;

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (!raw?.trim()) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      for (const node of collectJsonLdObjects(parsed)) {
        const email = node.email;
        if (typeof email === 'string') emails.push(email);
        if (Array.isArray(email)) {
          for (const e of email) if (typeof e === 'string') emails.push(e);
        }
        const tel = node.telephone;
        if (typeof tel === 'string') phones.push(tel);
        if (Array.isArray(tel)) {
          for (const t of tel) if (typeof t === 'string') phones.push(t);
        }
        const sameAs = node.sameAs;
        const sameList = Array.isArray(sameAs) ? sameAs : typeof sameAs === 'string' ? [sameAs] : [];
        for (const s of sameList) {
          if (typeof s !== 'string') continue;
          const li = normalizeLinkedInProfileUrl(s);
          if (li && !linkedinUrl) linkedinUrl = li;
        }
        const cps = node.contactPoint;
        const cpList = Array.isArray(cps) ? cps : cps ? [cps] : [];
        for (const cp of cpList) {
          if (cp && typeof cp === 'object') {
            const o = cp as Record<string, unknown>;
            if (typeof o.email === 'string') emails.push(o.email);
            if (typeof o.telephone === 'string') phones.push(o.telephone);
          }
        }
      }
    } catch {
      /* invalid JSON-LD */
    }
  });

  return {
    email: pickBestEmail(emails),
    phone: phones.find(Boolean),
    linkedinUrl,
  };
}

function buildContactPageCandidates(baseUrl: string): string[] {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [baseUrl];
  }
  const paths = [
    '/',
    '/contact',
    '/contact-us',
    '/contactus',
    '/about',
    '/about-us',
    '/team',
    '/our-team',
    '/meet-the-team',
    '/leadership',
    '/executive-team',
    '/management',
    '/property-management',
    '/staff',
    '/people',
    '/directory',
    '/leasing',
    '/connect',
    '/reach-us',
    '/get-in-touch',
    '/company',
    '/who-we-are',
  ];
  const urls: string[] = [];
  const seen: Record<string, boolean> = {};
  for (const p of paths) {
    const u = `${origin}${p === '/' ? '/' : p}`;
    if (!seen[u]) {
      seen[u] = true;
      urls.push(u);
    }
  }
  return urls;
}

/**
 * Parse a single HTML document for emails, phones, and a weak name hint.
 */
export function parseContactFromHtml(html: string): Partial<ScrapedManager> {
  const manager: Partial<ScrapedManager> = { source: 'website_scrape' };
  const $ = cheerio.load(html);

  const emails: string[] = [];
  const phones: string[] = [];

  const ld = extractContactFromJsonLd($);
  if (ld.email) emails.push(ld.email);
  if (ld.phone) phones.push(ld.phone);

  $('a[href^="mailto:"], a[href^="MAILTO:"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const addr = href.replace(/^mailto:/i, '').split('?')[0]?.trim();
    if (addr) emails.push(addr);
  });

  $('a[href^="tel:"], a[href^="TEL:"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const num = href.replace(/^tel:/i, '').trim();
    if (num) phones.push(num);
  });

  const bodyText = $.text();
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const fromText = bodyText.match(emailPattern);
  if (fromText) emails.push(...fromText);

  const phoneRe = /(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g;
  let phoneMatch: RegExpExecArray | null;
  while ((phoneMatch = phoneRe.exec(bodyText)) !== null) {
    phones.push(phoneMatch[0]);
  }

  const bestEmail = pickBestEmail(emails);
  if (bestEmail) manager.email = bestEmail;
  if (phones.length > 0) manager.phone = phones[0];

  const contactSection = $(
    'a[href*="contact"], a[href*="about"], div[class*="contact"], div[id*="contact"]'
  ).parent();
  if (contactSection.length > 0) {
    const text = contactSection.text();
    const namePattern = /([A-Z][a-z]+ [A-Z][a-z]+)/;
    const nameMatch = text.match(namePattern);
    if (nameMatch) manager.name = nameMatch[0];
  }

  const detectedRole = detectRoleFromText(bodyText);
  if (detectedRole && !manager.title) {
    manager.title = detectedRole;
  }

  if (!manager.linkedinUrl) {
    $('a[href*="linkedin.com"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const li = normalizeLinkedInProfileUrl(href);
      if (li) {
        manager.linkedinUrl = li;
        return false;
      }
    });
  }
  if (!manager.linkedinUrl) {
    const liRe = /https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+\/?/gi;
    const m = bodyText.match(liRe);
    if (m?.[0]) {
      const li = normalizeLinkedInProfileUrl(m[0]);
      if (li) manager.linkedinUrl = li;
    }
  }

  return manager;
}

function mergeManagerContact(base: ScrapedManager, patch: Partial<ScrapedManager>): ScrapedManager {
  return {
    ...base,
    name: base.name || patch.name,
    email: base.email || patch.email,
    phone: base.phone || patch.phone,
    website: base.website || patch.website,
    company: base.company || patch.company,
    title: base.title || patch.title,
    linkedinUrl: base.linkedinUrl || patch.linkedinUrl,
    source: base.source,
  };
}

async function fetchYelpBusinessesNear(
  lat: number,
  lon: number,
  apiKey: string,
  radiusMeters?: number
): Promise<YelpBusiness[]> {
  const terms = [
    'property management',
    'commercial real estate',
    'real estate services',
    'facilities management',
    'building services',
    'janitorial services',
  ];
  const byId = new Map<string, YelpBusiness>();
  /** Yelp Fusion max radius is 40000 m */
  const yelpRadius =
    radiusMeters != null
      ? Math.min(40_000, Math.max(1_000, Math.round(radiusMeters)))
      : 8000;

  for (const term of terms) {
    const { data } = await axios.get<YelpSearchResponse>('https://api.yelp.com/v3/businesses/search', {
      headers: { Authorization: `Bearer ${apiKey}` },
      params: {
        latitude: lat,
        longitude: lon,
        radius: yelpRadius,
        term,
        limit: 40,
        sort_by: 'distance',
      },
      timeout: 12000,
    });
    for (const b of data.businesses ?? []) {
      if (b?.id && b.name) byId.set(b.id, b);
    }
  }

  const list: YelpBusiness[] = [];
  byId.forEach(b => list.push(b));
  return list;
}

function mergeYelpIntoProperties(properties: ScrapedProperty[], yelpBiz: YelpBusiness[], zipCode: string): void {
  const shortZip = zipCode.slice(0, 5);
  for (const y of yelpBiz) {
    let matched: ScrapedProperty | undefined;
    for (const p of properties) {
      if (namesLikelyMatch(p.name, y.name)) {
        matched = p;
        break;
      }
    }

    const phone = y.display_phone || y.phone;
    const loc = y.location;
    const line1 = loc?.address1?.trim();
    const line2 = loc?.address2?.trim();
    const street = [line1, line2].filter(Boolean).join(', ') || 'Address from Yelp';

    if (matched) {
      const m = matched.managers[0];
      matched.managers[0] = mergeManagerContact(m, {
        phone: phone || m.phone,
        website: m.website || y.url,
        company: m.company || y.name,
      });
      const src = matched.source;
      matched.source = src.includes('yelp') ? src : `${src}+yelp`;
    } else {
      properties.push({
        name: y.name,
        address: street,
        city: loc?.city ?? '',
        state: loc?.state ?? '',
        zipCode: loc?.zip_code || shortZip,
        propertyType: 'yelp_business',
        source: 'yelp',
        sourceUrl: y.url,
        managers: [
          {
            phone,
            company: y.name,
            website: y.url,
            title: 'Business contact',
            source: 'yelp',
          },
        ],
      });
    }
  }
}

function mergeContactChunk(
  merged: Partial<ScrapedManager>,
  chunk: Partial<ScrapedManager>
): void {
  if (chunk.email && !merged.email) merged.email = chunk.email;
  if (chunk.phone && !merged.phone) merged.phone = chunk.phone;
  if (chunk.name && !merged.name) merged.name = chunk.name;
  if (chunk.linkedinUrl && !merged.linkedinUrl) merged.linkedinUrl = chunk.linkedinUrl;
  if (chunk.title && !merged.title) merged.title = chunk.title;
}

function enrichTargetsSatisfied(m: Partial<ScrapedManager>): boolean {
  if (ENV.playwrightEnrich) {
    return !!(m.email && m.phone && m.linkedinUrl);
  }
  return !!(m.email && m.phone);
}

/**
 * Crawl known paths + same-origin “contact / team / leadership” links (BFS) for email, phone, LinkedIn.
 */
export async function enrichFromWebsiteDeep(baseUrl: string): Promise<Partial<ScrapedManager>> {
  const merged: Partial<ScrapedManager> = { source: 'website_scrape' };
  const seen: Record<string, boolean> = {};
  const queue: string[] = [];
  const enqueue = (u: string) => {
    try {
      const n = new URL(u).href.split('#')[0];
      if (!n || seen[n]) return;
      seen[n] = true;
      queue.push(n);
    } catch {
      /* skip */
    }
  };

  for (const u of buildContactPageCandidates(baseUrl)) enqueue(u);

  const maxFetches = Number(process.env.SCRAPER_ENRICH_MAX_URL_FETCHES ?? '24') || 24;
  const maxDiscoverPerPage = Number(process.env.SCRAPER_ENRICH_DISCOVER_PER_PAGE ?? '12') || 12;
  let totalDiscovered = 0;
  const discoverBudget = Number(process.env.SCRAPER_ENRICH_DISCOVER_BUDGET ?? '20') || 20;
  let fetches = 0;

  while (queue.length > 0 && fetches < maxFetches) {
    const url = queue.shift()!;
    try {
      const response = await axios.get<string>(url, {
        timeout: 2800,
        maxRedirects: 4,
        headers: HTTP_BROWSER_HEADERS,
      });
      fetches++;
      const html = typeof response.data === 'string' ? response.data : String(response.data);
      const chunk = parseContactFromHtml(html);
      mergeContactChunk(merged, chunk);

      if (totalDiscovered < discoverBudget) {
        const extra = discoverEnrichUrlsFromPage(html, url, maxDiscoverPerPage);
        for (const raw of extra) {
          if (totalDiscovered >= discoverBudget) break;
          try {
            const n = new URL(raw).href.split('#')[0]!;
            if (!n || seen[n]) continue;
            seen[n] = true;
            queue.push(n);
            totalDiscovered++;
          } catch {
            /* skip */
          }
        }
      }

      if (enrichTargetsSatisfied(merged)) break;
    } catch {
      /* next URL */
    }
  }

  const needPlaywright =
    ENV.playwrightEnrich &&
    process.env.NODE_ENV !== 'test' &&
    !enrichTargetsSatisfied(merged);
  if (needPlaywright) {
    const html = await fetchHtmlWithPlaywright(baseUrl);
    if (html) {
      const chunk = parseContactFromHtml(html);
      mergeContactChunk(merged, chunk);
    }
  }

  return merged;
}

function collectLoopNetListingUrls(html: string): string[] {
  const $ = cheerio.load(html);
  const listingUrls: string[] = [];
  $('a[href*="/Listing/"]').each((_, el) => {
    const h = $(el).attr('href');
    if (!h) return;
    try {
      listingUrls.push(new URL(h, 'https://www.loopnet.com').href.split('#')[0]!);
    } catch {
      /* skip */
    }
  });
  return Array.from(new Set(listingUrls)).slice(0, 3);
}

/** LoopNet is JS-heavy and often blocks plain HTTP clients; Playwright helps only when enabled. */
async function fetchLoopNetPageHtml(url: string): Promise<string | null> {
  try {
    const { data } = await axios.get<string>(url, {
      timeout: 10000,
      maxRedirects: 3,
      headers: HTTP_BROWSER_HEADERS,
    });
    if (typeof data === 'string' && data.length > 500) return data;
  } catch {
    /* fall through */
  }
  if (ENV.playwrightEnrich && process.env.NODE_ENV !== 'test') {
    return fetchHtmlWithPlaywright(url);
  }
  return null;
}

async function enrichFromLoopNetSearch(
  property: ScrapedProperty,
  merged: Partial<ScrapedManager>
): Promise<void> {
  if (!ENV.loopnetEnrich || process.env.NODE_ENV === 'test') return;
  if (merged.email && merged.phone) return;

  const q = `${property.name} ${property.city} ${property.state}`.trim();
  const searchUrl = `https://www.loopnet.com/search?q=${encodeURIComponent(q)}`;

  try {
    let html = await fetchLoopNetPageHtml(searchUrl);
    let unique = html ? collectLoopNetListingUrls(html) : [];
    if (unique.length === 0 && ENV.playwrightEnrich && process.env.NODE_ENV !== 'test') {
      html = await fetchHtmlWithPlaywright(searchUrl);
      unique = html ? collectLoopNetListingUrls(html) : [];
    }

    for (const listUrl of unique) {
      try {
        const phtml = await fetchLoopNetPageHtml(listUrl);
        if (!phtml) continue;
        const chunk = parseContactFromHtml(phtml);
        mergeContactChunk(merged, chunk);
        if (merged.email && merged.phone) break;
      } catch {
        /* next listing */
      }
    }
  } catch {
    /* LoopNet may block or change markup — optional path */
  }
}

async function enrichFromBingWeb(
  property: ScrapedProperty,
  manager: ScrapedManager,
  merged: Partial<ScrapedManager>
): Promise<void> {
  const key = ENV.bingSearchApiKey;
  if (!key || process.env.NODE_ENV === 'test') return;
  if (merged.email && merged.phone) return;

  const company = manager.company ?? property.name;
  const q = `${company} ${property.city} ${property.state} commercial property management contact email phone`;
  try {
    const { data } = await axios.get<{
      webPages?: { value?: Array<{ url?: string; snippet?: string; name?: string }> };
    }>('https://api.bing.microsoft.com/v7.0/search', {
      params: { q, count: 6, mkt: 'en-US' },
      timeout: 12000,
      headers: { 'Ocp-Apim-Subscription-Key': key },
    });

    const pages = data.webPages?.value ?? [];
    const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

    for (const page of pages) {
      const blob = `${page.snippet ?? ''} ${page.name ?? ''}`;
      const fromSnippet = blob.match(emailRe);
      if (fromSnippet?.length) {
        const best = pickBestEmail(fromSnippet);
        if (best && !merged.email) merged.email = best;
      }
    }

    for (const page of pages) {
      if (merged.email && merged.phone) break;
      const u = page.url;
      if (!u || /linkedin\.com\/(login|signup|auth)/i.test(u)) continue;
      try {
        const { data: html } = await axios.get<string>(u, {
          timeout: 3500,
          maxRedirects: 3,
          headers: HTTP_BROWSER_HEADERS,
        });
        const chunk = parseContactFromHtml(html);
        mergeContactChunk(merged, chunk);
      } catch {
        /* next result */
      }
    }
  } catch {
    /* Bing quota / network */
  }
}

async function runFullEnrichmentForProperty(property: ScrapedProperty): Promise<void> {
  let manager = property.managers[0];
  if (!manager) return;

  if (manager.website) {
    const deep = await enrichFromWebsiteDeep(manager.website);
    manager = mergeManagerContact(manager, deep);
  }

  if (ENV.loopnetEnrich && (!manager.email || !manager.phone)) {
    const ln: Partial<ScrapedManager> = { source: 'loopnet_enrich' };
    await enrichFromLoopNetSearch(property, ln);
    manager = mergeManagerContact(manager, ln);
  }

  if (ENV.bingSearchApiKey && (!manager.email || !manager.phone)) {
    const b: Partial<ScrapedManager> = { source: 'bing_enrich' };
    await enrichFromBingWeb(property, manager, b);
    manager = mergeManagerContact(manager, b);
  }

  property.managers[0] = manager;
}

async function getZipCenter(zipCode: string) {
  const shortZip = zipCode.slice(0, 5);
  const { data } = await axios.get<ZipLookupResponse>(
    `https://api.zippopotam.us/us/${shortZip}`,
    { timeout: 8000 }
  );
  const place = data.places?.[0];
  if (!place?.latitude || !place?.longitude) {
    throw new Error(`Could not geocode ZIP code: ${shortZip}`);
  }
  return {
    lat: Number(place.latitude),
    lon: Number(place.longitude),
    city: place['place name'] ?? '',
    state: place['state abbreviation'] ?? place.state ?? '',
    zipCode: shortZip,
  };
}

async function getCityCenter(cityQuery: string) {
  const { data } = await axios.get<NominatimResponse>(
    'https://nominatim.openstreetmap.org/search',
    {
      params: {
        q: cityQuery,
        countrycodes: 'us',
        format: 'jsonv2',
        limit: 1,
        addressdetails: 1,
      },
      timeout: 10000,
      headers: {
        'User-Agent': 'PropertyManager/1.0',
      },
    }
  );

  const first = data[0];
  if (!first?.lat || !first?.lon) {
    throw new Error(`Could not geocode city: ${cityQuery}`);
  }
  const a = first.address;
  return {
    lat: Number(first.lat),
    lon: Number(first.lon),
    city: a?.city ?? a?.town ?? a?.village ?? cityQuery,
    state: a?.state ?? '',
    zipCode: a?.postcode ?? '',
  };
}

function detectRoleFromText(text: string): string | undefined {
  for (const p of TARGET_ROLE_PATTERNS) {
    const m = text.match(p);
    if (m?.[0]) {
      return m[0]
        .toLowerCase()
        .replace(/\b\w/g, c => c.toUpperCase());
    }
  }
  return undefined;
}

function parseBuildingSizeSqft(tags: Record<string, string> | undefined): number | undefined {
  if (!tags) return undefined;
  const areaRaw = tags['building:area'] || tags['area'] || tags['floor_area'];
  if (areaRaw) {
    const n = Number(areaRaw.replace(/[^\d.]/g, ''));
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  const levelsRaw = tags['building:levels'];
  if (levelsRaw) {
    const levels = Number(levelsRaw.replace(/[^\d.]/g, ''));
    if (Number.isFinite(levels) && levels > 0) {
      return Math.round(levels * 10000);
    }
  }
  return undefined;
}

function normalizeWebsite(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function buildAddress(tags: Record<string, string> | undefined, fallbackCity: string, fallbackState: string, zipCode: string) {
  const house = tags?.['addr:housenumber'] ?? '';
  const street = tags?.['addr:street'] ?? '';
  const city = tags?.['addr:city'] ?? fallbackCity;
  const state = tags?.['addr:state'] ?? fallbackState;
  const postal = tags?.['addr:postcode'] ?? zipCode.slice(0, 5);
  const firstLine = `${house} ${street}`.trim();
  return {
    address: firstLine || tags?.name || 'Address unavailable',
    city,
    state,
    zipCode: postal,
  };
}

/**
 * OSM often has building=* without name=; city-wide queries need fallbacks or we keep zero rows.
 */
function buildOsmDisplayName(tags: Record<string, string>): string | undefined {
  const n = tags.name?.trim();
  if (n) return n;
  const house = tags['addr:housenumber']?.trim();
  const street = tags['addr:street']?.trim();
  if (house && street) return `${house} ${street}`;
  if (street) return street;
  const op = tags.operator?.trim() || tags.brand?.trim();
  if (op) return op;
  const kind = tags.building || tags.office || tags.amenity;
  if (kind?.trim()) return `Building (${kind.trim()})`;
  return undefined;
}

function readOverpassMaxElements(): number {
  const raw = process.env.SCRAPER_OVERPASS_MAX_ELEMENTS;
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 50 && n <= 10000) return Math.floor(n);
  }
  return 500;
}

function buildOverpassQueryBody(radiusM: number, maxOut: number, lat: number, lon: number): string {
  return `
[out:json][timeout:120];
(
  node["office"~"property_management|real_estate|company|commercial|government"](around:${radiusM},${lat},${lon});
  way["office"~"property_management|real_estate|company|commercial|government"](around:${radiusM},${lat},${lon});
  node["office"="property_management"](around:${radiusM},${lat},${lon});
  way["office"="property_management"](around:${radiusM},${lat},${lon});
  node["building"~"commercial|office|hospital|school|university|public|civic|retail|industrial"](around:${radiusM},${lat},${lon});
  way["building"~"commercial|office|hospital|school|university|public|civic|retail|industrial"](around:${radiusM},${lat},${lon});
  node["amenity"~"hospital|clinic|doctors|school|college|university"](around:${radiusM},${lat},${lon});
  way["amenity"~"hospital|clinic|doctors|school|college|university"](around:${radiusM},${lat},${lon});
);
out center tags qt ${maxOut};
`.trim();
}

/** ZIP centroids cover a small area; city names need a wider net or Overpass returns the wrong 80 buildings. */
function readOverpassRadiusM(isZipQuery: boolean): number {
  const fallback = isZipQuery ? 9000 : 22000;
  const key = isZipQuery ? 'SCRAPER_OVERPASS_RADIUS_ZIP_M' : 'SCRAPER_OVERPASS_RADIUS_CITY_M';
  const raw = process.env[key] ?? process.env.SCRAPER_OVERPASS_RADIUS_M;
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1000 && n <= 50000) return Math.floor(n);
  }
  return fallback;
}

/**
 * Overpass public instances often time out or return 0 elements past ~50 km.
 * ~31 mi is a safe upper bound; larger UI values are clamped (logged).
 */
const OVERPASS_MAX_RADIUS_M = 50_000;

function clampOverpassRadiusMeters(m: number): number {
  const r = Math.min(OVERPASS_MAX_RADIUS_M, Math.max(1_000, Math.round(m)));
  if (Math.round(m) > OVERPASS_MAX_RADIUS_M) {
    console.warn(
      `[Scraper] Requested radius ${m}m exceeds Overpass safe max ${OVERPASS_MAX_RADIUS_M}m — using ${r}m`
    );
  }
  return r;
}

export type ScrapeLocationOptions = {
  /** Overrides env defaults when set (meters). Used for ZIP + user-chosen radius. */
  radiusMeters?: number;
  /** Min sq ft to keep after OSM fetch; 0 = keep all sizes. Overrides SCRAPER_MIN_SQFT when set. */
  minSqft?: number;
  /** When true, keep buildings with no OSM size tag under min-sqft rules. Overrides SCRAPER_INCLUDE_UNKNOWN_SIZE when set. */
  includeUnknownSize?: boolean;
};

function resolveSqftPolicy(options?: ScrapeLocationOptions): { min: number; includeUnknown: boolean } {
  const env = readMinSqftScrapePolicy();
  if (!options) return env;
  return {
    min: options.minSqft !== undefined ? Math.max(0, options.minSqft) : env.min,
    includeUnknown:
      options.includeUnknownSize !== undefined ? options.includeUnknownSize : env.includeUnknown,
  };
}

/**
 * Scrape commercial properties from Google Maps for a given ZIP code.
 * This is a simplified implementation that demonstrates the concept.
 * In production, you would use the Google Places API or a dedicated scraping service.
 */
export async function scrapeGoogleMapsProperties(
  searchQuery: string,
  options?: ScrapeLocationOptions
): Promise<ScrapedProperty[]> {
  const properties: ScrapedProperty[] = [];

  try {
    const normalizedZip = normalizeZipCode(searchQuery);
    const center = normalizedZip
      ? await getZipCenter(normalizedZip)
      : await getCityCenter(searchQuery);
    const initialRadiusM =
      options?.radiusMeters != null && Number.isFinite(options.radiusMeters)
        ? clampOverpassRadiusMeters(options.radiusMeters)
        : readOverpassRadiusM(!!normalizedZip);
    const maxOut = readOverpassMaxElements();
    console.log(
      `[Scraper] Looking up live commercial data for query: ${searchQuery} (city: ${center.city}, state: ${center.state}, initialRadius=${initialRadiusM}m, maxOut=${maxOut})`
    );

    const overpassEndpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass.openstreetmap.fr/api/interpreter',
    ];

    let radiusTry = initialRadiusM;
    let data: OverpassResponse | null = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const overpassQuery = buildOverpassQueryBody(radiusTry, maxOut, center.lat, center.lon);
      let lastOverpassErr: unknown;
      let attemptData: OverpassResponse | null = null;
      for (const endpoint of overpassEndpoints) {
        try {
          const response = await axios.post<OverpassResponse>(endpoint, overpassQuery, {
            timeout: 110000,
            headers: { 'Content-Type': 'text/plain' },
          });
          attemptData = response.data;
          break;
        } catch (error) {
          lastOverpassErr = error;
          if (!axios.isAxiosError(error)) throw error;
          const status = error.response?.status ?? 0;
          console.warn(
            `[Scraper] Overpass endpoint failed (${endpoint}): ${status || error.code || error.message}`
          );
        }
      }
      if (!attemptData) {
        const msg =
          lastOverpassErr instanceof Error ? lastOverpassErr.message : 'all Overpass mirrors failed';
        throw new Error(`Overpass unavailable: ${msg}`);
      }
      data = attemptData;

      const rawCount = data.elements?.length ?? 0;
      console.log(
        `[Scraper] Overpass attempt ${attempt + 1}: radius=${radiusTry}m rawElements=${rawCount}`,
        data.remark ? `remark=${data.remark}` : ''
      );
      if (rawCount > 0) break;

      if (radiusTry <= 12_000) break;
      const nextR = Math.max(12_000, Math.floor(radiusTry / 2));
      console.warn(`[Scraper] Overpass returned 0 elements — retrying with radius ${nextR}m`);
      radiusTry = nextR;
    }

    const radiusM = radiusTry;

    if (!data) {
      throw new Error('Overpass returned no data');
    }

    const seen = new Set<string>();
    for (const element of data.elements ?? []) {
      const tags = element.tags ?? {};
      const name = buildOsmDisplayName(tags);
      if (!name) continue;

      const addr = buildAddress(tags, center.city, center.state, normalizedZip ?? center.zipCode ?? '');
      const dedupeKey = `${name.toLowerCase()}|${addr.address.toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const website = normalizeWebsite(tags.website ?? tags['contact:website']);
      const manager: ScrapedManager = {
        name: tags['contact:name'] ?? undefined,
        email: tags.email ?? tags['contact:email'] ?? undefined,
        phone: tags.phone ?? tags['contact:phone'] ?? undefined,
        company: name,
        title:
          tags['contact:position'] ??
          tags['operator:type'] ??
          detectRoleFromText([tags.office, tags.amenity, tags.building, tags.name].filter(Boolean).join(' ')) ??
          'Operations Contact',
        website,
        source: 'openstreetmap',
      };

      properties.push({
        name,
        address: addr.address,
        city: addr.city,
        state: addr.state,
        zipCode: addr.zipCode,
        propertyType: tags.office ?? tags.amenity ?? tags.building ?? tags.shop ?? 'commercial',
        buildingLevels: tags['building:levels']
          ? Number(tags['building:levels'].replace(/[^\d.]/g, '')) || undefined
          : undefined,
        buildingSizeSqft: parseBuildingSizeSqft(tags),
        source: 'openstreetmap',
        sourceUrl: website,
        managers: [manager],
      });
    }

    if (ENV.yelpApiKey && process.env.NODE_ENV !== 'test') {
      try {
        const yelpBiz = await fetchYelpBusinessesNear(center.lat, center.lon, ENV.yelpApiKey, radiusM);
        mergeYelpIntoProperties(properties, yelpBiz, normalizedZip ?? center.zipCode ?? '');
        console.log(`[Scraper] Yelp: merged/added from ${yelpBiz.length} businesses`);
      } catch (err) {
        console.warn(
          '[Scraper] Yelp enrichment failed:',
          err instanceof Error ? err.message : err
        );
      }
    }

    filterPropertiesByMinSqft(properties, resolveSqftPolicy(options));

    // Multi-step enrichment: crawl site (paths + discovered links), optional Playwright, LoopNet, Bing.
    if (process.env.NODE_ENV !== 'test') {
      const max = Math.min(
        properties.length,
        Number(process.env.SCRAPER_WEB_ENRICH_MAX ?? '25') || 25
      );
      const batchSize = 3;
      for (let i = 0; i < max; i += batchSize) {
        const batch = properties.slice(i, i + batchSize);
        await Promise.all(batch.map(p => runFullEnrichmentForProperty(p)));
      }
    }
  } catch (error) {
    console.error(`[Scraper] Error scraping live sources:`, error);
    throw error instanceof Error ? error : new Error(String(error));
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
 * Extract contact information from a single page (homepage URL).
 */
export async function extractContactFromWebsite(url: string): Promise<Partial<ScrapedManager>> {
  try {
    const response = await axios.get<string>(url, {
      timeout: 2500,
      headers: HTTP_BROWSER_HEADERS,
    });
    const html = typeof response.data === 'string' ? response.data : String(response.data);
    return parseContactFromHtml(html);
  } catch {
    return { source: 'website_scrape' };
  }
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
export async function scrapePropertiesForZipCode(
  searchQuery: string,
  options?: ScrapeLocationOptions
): Promise<ScrapedProperty[]> {
  const cleaned = searchQuery.trim();
  if (!cleaned) {
    throw new Error('Search query is required');
  }
  const normalizedZip = normalizeZipCode(cleaned);
  const normalized = normalizedZip ?? cleaned;
  const resolvedRadius =
    options?.radiusMeters != null && Number.isFinite(options.radiusMeters)
      ? clampOverpassRadiusMeters(options.radiusMeters)
      : readOverpassRadiusM(!!normalizedZip);
  const sqftPolicy = resolveSqftPolicy(options);
  const cacheKey = `${normalized.toLowerCase()}|r=${resolvedRadius}|sq=${sqftPolicy.min}|u=${sqftPolicy.includeUnknown ? 1 : 0}`;

  const cached = zipResultCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.properties;
  }

  const existing = inFlightScrapes.get(cacheKey);
  if (existing) {
    return existing;
  }

  const runScrape = (async () => {
    const properties: ScrapedProperty[] = [];
    // Attempt to scrape from multiple sources
    console.log(`[Scraper] Starting scrape for query: ${normalized}`);

    // Primary source for local open-access mode
    const gmapsProperties = await scrapeGoogleMapsProperties(normalized, options);
    properties.push(...gmapsProperties);

    // Try county assessor (would be county-specific in production)
    // Extract state from ZIP code context (would need to be passed in)
    // const countyProperties = await scrapeCountyAssessorProperties(normalized, state);
    // properties.push(...countyProperties);

    console.log(`[Scraper] Scrape completed. Found ${properties.length} properties`);
    if (properties.length > 0) {
      zipResultCache.set(cacheKey, {
        expiresAt: Date.now() + ZIP_RESULT_CACHE_TTL_MS,
        properties,
      });
    }
    return properties;
  })();

  inFlightScrapes.set(cacheKey, runScrape);
  try {
    return await runScrape;
  } catch (error) {
    console.error(`[Scraper] Error during scraping:`, error);
    throw error;
  } finally {
    inFlightScrapes.delete(cacheKey);
  }
}
