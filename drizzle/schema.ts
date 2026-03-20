import { boolean, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Scraping jobs track each time a user initiates a scrape for a specific ZIP code.
 */
export const scrapingJobs = mysqlTable('scraping_jobs', {
  id: int('id').autoincrement().primaryKey(),
  userId: int('userId').notNull().references(() => users.id),
  zipCode: varchar('zipCode', { length: 10 }).notNull(),
  status: mysqlEnum('status', ['pending', 'running', 'completed', 'failed']).default('pending').notNull(),
  totalProperties: int('totalProperties').default(0),
  totalManagers: int('totalManagers').default(0),
  errorMessage: text('errorMessage'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  completedAt: timestamp('completedAt'),
  updatedAt: timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),
});

export type ScrapingJob = typeof scrapingJobs.$inferSelect;
export type InsertScrapingJob = typeof scrapingJobs.$inferInsert;

/**
 * Commercial properties discovered during scraping.
 */
export const commercialProperties = mysqlTable('commercial_properties', {
  id: int('id').autoincrement().primaryKey(),
  scrapingJobId: int('scrapingJobId').notNull().references(() => scrapingJobs.id),
  name: varchar('name', { length: 255 }).notNull(),
  address: varchar('address', { length: 255 }).notNull(),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 2 }),
  zipCode: varchar('zipCode', { length: 10 }),
  propertyType: varchar('propertyType', { length: 100 }),
  source: varchar('source', { length: 50 }).notNull(), // 'google_maps', 'county_assessor', etc.
  sourceUrl: text('sourceUrl'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
});

export type CommercialProperty = typeof commercialProperties.$inferSelect;
export type InsertCommercialProperty = typeof commercialProperties.$inferInsert;

/**
 * Property managers associated with commercial properties.
 */
export const propertyManagers = mysqlTable('property_managers', {
  id: int('id').autoincrement().primaryKey(),
  propertyId: int('propertyId').notNull().references(() => commercialProperties.id),
  name: varchar('name', { length: 255 }),
  email: varchar('email', { length: 320 }),
  phone: varchar('phone', { length: 20 }),
  company: varchar('company', { length: 255 }),
  title: varchar('title', { length: 100 }),
  website: varchar('website', { length: 255 }),
  source: varchar('source', { length: 50 }).notNull(), // 'google_maps', 'website_scrape', etc.
  verified: boolean('verified').default(false).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),
});

export type PropertyManager = typeof propertyManagers.$inferSelect;
export type InsertPropertyManager = typeof propertyManagers.$inferInsert;