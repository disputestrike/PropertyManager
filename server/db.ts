import { eq, desc, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { InsertUser, users, scrapingJobs, commercialProperties, propertyManagers, ScrapingJob, CommercialProperty, PropertyManager, User, InsertScrapingJob, InsertCommercialProperty, InsertPropertyManager } from "../drizzle/schema";
import { ENV } from './_core/env';

/** Shared openId when running without OAuth (open local / single-user mode) */
export const LOCAL_DEV_OPEN_ID = "local-dev-user";

/**
 * Drizzle mysql2 insert resolves to `[ResultSetHeader, FieldPacket[]]` — use `insertId`, not the header object.
 * Exported for unit tests.
 */
export function readMysqlInsertId(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  if (header && typeof header === "object" && "insertId" in header) {
    const raw = (header as { insertId: unknown }).insertId;
    const n = typeof raw === "bigint" ? Number(raw) : Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  throw new Error("Could not read insertId from MySQL insert result");
}

let _db: ReturnType<typeof drizzle> | null = null;
let _schemaCompatPromise: Promise<void> | null = null;

/**
 * If Drizzle expects columns that are missing locally (e.g. before `pnpm db:migrate`),
 * add them so SELECT/INSERT match the schema. Safe no-op when the column already exists.
 */
async function ensurePropertyManagersLinkedinColumn(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return;

  const pool = mysql.createPool(url);
  try {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'property_managers'
         AND COLUMN_NAME = 'linkedinUrl'`
    );
    const cnt = Number(rows[0]?.cnt ?? 0);
    if (cnt === 0) {
      await pool.query(
        "ALTER TABLE `property_managers` ADD COLUMN `linkedinUrl` varchar(512) NULL"
      );
      console.log("[Database] Added missing column property_managers.linkedinUrl (auto-migrate)");
    }
  } finally {
    await pool.end();
  }
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      if (!_schemaCompatPromise) {
        _schemaCompatPromise = ensurePropertyManagersLinkedinColumn().catch(err => {
          console.warn(
            "[Database] Could not verify/add linkedinUrl column — run `pnpm db:migrate` if queries fail:",
            err instanceof Error ? err.message : err
          );
        });
      }
      await _schemaCompatPromise;
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

/** Create or update a synthetic user for local development when OAuth is not configured. */
export async function ensureLocalDevUser(): Promise<User | null> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Open-access user: DATABASE_URL not set or connection failed");
    return null;
  }

  await upsertUser({
    openId: LOCAL_DEV_OPEN_ID,
    name: "Local Dev",
    email: "dev@localhost",
    loginMethod: "local_dev",
  });

  const user = await getUserByOpenId(LOCAL_DEV_OPEN_ID);
  return user ?? null;
}

// Scraping job queries

export async function createScrapingJob(input: InsertScrapingJob): Promise<ScrapingJob> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(scrapingJobs).values(input);
  const jobId = readMysqlInsertId(result);

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

/** When OAuth is not configured, treat the app as single-tenant: show all scrape jobs. */
export async function listScrapingJobsForSession(userId: number, singleTenant: boolean): Promise<ScrapingJob[]> {
  const db = await getDb();
  if (!db) return [];

  if (singleTenant) {
    return db.select().from(scrapingJobs).orderBy(desc(scrapingJobs.createdAt));
  }
  return getUserScrapingJobs(userId);
}

export async function getScrapingJobIfReadable(
  jobId: number,
  userId: number,
  singleTenant: boolean
): Promise<ScrapingJob | undefined> {
  const job = await getScrapingJob(jobId);
  if (!job) return undefined;
  if (singleTenant || job.userId === userId) return job;
  return undefined;
}

function isMissingLinkedinColumnError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  if (/linkedinUrl/i.test(msg) && /(Unknown column|doesn't exist|does not exist)/i.test(msg)) {
    return true;
  }
  if (error && typeof error === "object") {
    const o = error as { code?: string; errno?: number };
    if (o.code === "ER_BAD_FIELD_ERROR" || o.errno === 1054) return true;
  }
  return false;
}

/** OSM / scrapers sometimes emit multiple numbers in one field; varchar was 20 chars and inserts failed. */
function sanitizePhoneForDb(value: string | null | undefined): string | undefined {
  if (value == null || value === "") return undefined;
  let s = String(value).trim();
  const semi = s.indexOf(";");
  if (semi !== -1) s = s.slice(0, semi).trim();
  if (s.length > 128) s = s.slice(0, 128);
  return s || undefined;
}

export async function createPropertyManager(input: InsertPropertyManager): Promise<PropertyManager> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const row: InsertPropertyManager = {
    ...input,
    phone: sanitizePhoneForDb(input.phone ?? undefined),
  };

  try {
    const result = await db.insert(propertyManagers).values(row);
    const managerId = readMysqlInsertId(result);

    const manager = await db.select().from(propertyManagers).where(eq(propertyManagers.id, managerId)).limit(1);
    if (!manager[0]) throw new Error("Failed to create property manager");

    return manager[0];
  } catch (error) {
    if (input.linkedinUrl && isMissingLinkedinColumnError(error)) {
      const { linkedinUrl: _omit, ...rest } = row;
      const result = await db.insert(propertyManagers).values(rest);
      const managerId = readMysqlInsertId(result);
      const manager = await db.select().from(propertyManagers).where(eq(propertyManagers.id, managerId)).limit(1);
      if (!manager[0]) throw new Error("Failed to create property manager");
      console.warn(
        "[Database] Saved manager without linkedinUrl — run `pnpm db:migrate` to add the linkedinUrl column."
      );
      return manager[0];
    }
    throw error;
  }
}

export async function deleteScrapingJobCascade(jobId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const props = await db
    .select({ id: commercialProperties.id })
    .from(commercialProperties)
    .where(eq(commercialProperties.scrapingJobId, jobId));

  const propIds = props.map(p => p.id);
  if (propIds.length > 0) {
    await db.delete(propertyManagers).where(inArray(propertyManagers.propertyId, propIds));
  }
  await db.delete(commercialProperties).where(eq(commercialProperties.scrapingJobId, jobId));
  await db.delete(scrapingJobs).where(eq(scrapingJobs.id, jobId));
}

// Commercial property queries

export async function createCommercialProperty(input: InsertCommercialProperty): Promise<CommercialProperty> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(commercialProperties).values(input);
  const propId = readMysqlInsertId(result);

  const prop = await db.select().from(commercialProperties).where(eq(commercialProperties.id, propId)).limit(1);
  if (!prop[0]) throw new Error("Failed to create property");
  
  return prop[0];
}

export async function getPropertiesByScrapingJob(jobId: number): Promise<CommercialProperty[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(commercialProperties).where(eq(commercialProperties.scrapingJobId, jobId));
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
