import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch {
    // No valid OAuth session — optional for public procedures.
    user = null;
  }

  // Open local app: single shared DB user when OAuth is not used (no login required).
  if (!user) {
    user = await db.ensureLocalDevUser();
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
