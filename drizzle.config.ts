import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Prefer repo `.env` over inherited shell/system DATABASE_URL (avoids ETIMEDOUT to wrong host).
config({ override: true });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    url: connectionString,
  },
});
