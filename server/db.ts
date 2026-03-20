import { eq, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, scrapingJobs, commercialProperties, propertyManagers, ScrapingJob, CommercialProperty, PropertyManager, InsertScrapingJob, InsertCommercialProperty, InsertPropertyManager } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// Scraping job queries

export async function createScrapingJob(input: InsertScrapingJob): Promise<ScrapingJob> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(scrapingJobs).values(input);
  const jobId = (result as any).insertId || result[0];
  
  const job = await db.select().from(scrapingJobs).where(eq(scrapingJobs.id, jobId)).limit(1);
  if (!job[0]) throw new Error("Failed to create scraping job");
  
  return job[0];
}

export async function getScrapingJob(jobId: number): Promise<ScrapingJob | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(scrapingJobs).where(eq(scrapingJobs.id, jobId)).limit(1);
  return result[0];
}

export async function updateScrapingJob(jobId: number, updates: Partial<ScrapingJob>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(scrapingJobs).set(updates).where(eq(scrapingJobs.id, jobId));
}

export async function getUserScrapingJobs(userId: number): Promise<ScrapingJob[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(scrapingJobs).where(eq(scrapingJobs.userId, userId)).orderBy(desc(scrapingJobs.createdAt));
}

// Commercial property queries

export async function createCommercialProperty(input: InsertCommercialProperty): Promise<CommercialProperty> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(commercialProperties).values(input);
  const propId = (result as any).insertId || result[0];
  
  const prop = await db.select().from(commercialProperties).where(eq(commercialProperties.id, propId)).limit(1);
  if (!prop[0]) throw new Error("Failed to create property");
  
  return prop[0];
}

export async function getPropertiesByScrapingJob(jobId: number): Promise<CommercialProperty[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(commercialProperties).where(eq(commercialProperties.scrapingJobId, jobId));
}

// Property manager queries

export async function createPropertyManager(input: InsertPropertyManager): Promise<PropertyManager> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(propertyManagers).values(input);
  const managerId = (result as any).insertId || result[0];
  
  const manager = await db.select().from(propertyManagers).where(eq(propertyManagers.id, managerId)).limit(1);
  if (!manager[0]) throw new Error("Failed to create property manager");
  
  return manager[0];
}

export async function getManagersByProperty(propertyId: number): Promise<PropertyManager[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(propertyManagers).where(eq(propertyManagers.propertyId, propertyId));
}

export async function getPropertyWithManagers(propertyId: number): Promise<{ property: CommercialProperty; managers: PropertyManager[] } | null> {
  const db = await getDb();
  if (!db) return null;

  const prop = await db.select().from(commercialProperties).where(eq(commercialProperties.id, propertyId)).limit(1);
  if (!prop[0]) return null;

  const managers = await getManagersByProperty(propertyId);
  return { property: prop[0], managers };
}
