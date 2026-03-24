import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { scrapePropertiesForZipCode, type ScrapeLocationOptions } from "./scraper";
import {
  createScrapingJob,
  updateScrapingJob,
  createCommercialProperty,
  getPropertiesByScrapingJob,
  createPropertyManager,
  getManagersByProperty,
  listScrapingJobsForSession,
  getScrapingJobIfReadable,
  deleteScrapingJobCascade,
} from "./db";
import { notifyOwner } from "./_core/notification";
import { ENV } from "./_core/env";

/**
 * When true, all scraping jobs are visible (single shared history).
 * When false, jobs are limited to ctx.user — only appropriate when OAuth is really in use.
 *
 * Local dev often has OAUTH_SERVER_URL set for tooling while sessions bounce between
 * OAuth cookies and the synthetic local-dev user; per-user filtering then hides “old” runs.
 */
function scraperSingleTenantMode(): boolean {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.SCRAPER_ISOLATE_JOBS_BY_USER !== "1"
  ) {
    return true;
  }
  return !ENV.oAuthServerUrl?.trim();
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  scraper: router({
    scrapeZipCode: protectedProcedure
      .input(
        z.object({
          query: z.string().min(2).max(120),
          /** Miles around the ZIP centroid (5–50). */
          radiusMiles: z.coerce.number().min(5).max(30).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const job = await createScrapingJob({
            userId: ctx.user.id,
            zipCode: input.query,
            status: 'running',
          });

          (async () => {
            try {
              const radiusMeters =
                input.radiusMiles != null ? Math.round(input.radiusMiles * 1609.344) : undefined;
              /** Always save all OSM rows here — size filtering is UI-only. Ignores SCRAPER_MIN_SQFT for app runs. */
              const scrapeOpts: ScrapeLocationOptions = {
                minSqft: 0,
                includeUnknownSize: true,
                ...(radiusMeters !== undefined ? { radiusMeters } : {}),
              };
              const properties = await scrapePropertiesForZipCode(input.query, scrapeOpts);
              let totalManagers = 0;

              for (const prop of properties) {
                const savedProp = await createCommercialProperty({
                  scrapingJobId: job.id,
                  name: prop.name,
                  address: prop.address,
                  city: prop.city,
                  state: prop.state,
                  zipCode: prop.zipCode,
                  propertyType: prop.propertyType,
                  buildingSizeSqft: prop.buildingSizeSqft,
                  buildingLevels: prop.buildingLevels,
                  source: prop.source,
                  sourceUrl: prop.sourceUrl,
                });

                for (const manager of prop.managers) {
                  await createPropertyManager({
                    propertyId: savedProp.id,
                    name: manager.name,
                    email: manager.email,
                    phone: manager.phone,
                    company: manager.company,
                    title: manager.title,
                    website: manager.website,
                    linkedinUrl: manager.linkedinUrl,
                    source: manager.source,
                  });
                  totalManagers++;
                }
              }

              await updateScrapingJob(job.id, {
                status: 'completed',
                totalProperties: properties.length,
                totalManagers: totalManagers,
                completedAt: new Date(),
              });

              await notifyOwner({
                title: 'Property Scraping Complete',
                content: `Scraping job for query "${input.query}" completed successfully. Found ${properties.length} properties with ${totalManagers} contacts.`,
              });

            } catch (error) {
              console.error('[Scraper] Background job failed:', error);
              await updateScrapingJob(job.id, {
                status: 'failed',
                errorMessage: error instanceof Error ? error.message : 'Unknown error',
              });

              await notifyOwner({
                title: 'Property Scraping Failed',
                content: `Scraping job for query "${input.query}" failed. Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              });
            }
          })();

          return {
            jobId: job.id,
            status: job.status,
            zipCode: job.zipCode,
            message: 'Scraping job started.',
          };
        } catch (error) {
          console.error('[Scraper] Error creating scraping job:', error);
          throw error;
        }
      }),

    getJobHistory: protectedProcedure.query(async ({ ctx }) => {
      return listScrapingJobsForSession(ctx.user.id, scraperSingleTenantMode());
    }),

    getJobResults: protectedProcedure
      .input(z.object({
        jobId: z.number(),
      }))
      .query(async ({ ctx, input }) => {
        const job = await getScrapingJobIfReadable(
          input.jobId,
          ctx.user.id,
          scraperSingleTenantMode()
        );
        if (!job) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Job not found or you do not have access.",
          });
        }

        const properties = await getPropertiesByScrapingJob(input.jobId);

        const propertiesWithManagers = await Promise.all(
          properties.map(async (prop) => ({
            ...prop,
            managers: await getManagersByProperty(prop.id),
          }))
        );

        return {
          job,
          properties: propertiesWithManagers,
        };
      }),

    deleteScrapingJob: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const job = await getScrapingJobIfReadable(
          input.jobId,
          ctx.user.id,
          scraperSingleTenantMode()
        );
        if (!job) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Job not found or you do not have access.",
          });
        }
        await deleteScrapingJobCascade(input.jobId);
        return { ok: true as const };
      }),
  }),
});

export type AppRouter = typeof appRouter;
