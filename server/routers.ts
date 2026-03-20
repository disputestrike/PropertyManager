import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import { scrapePropertiesForZipCode } from "./scraper";
import { createScrapingJob, updateScrapingJob, getUserScrapingJobs, createCommercialProperty, getPropertiesByScrapingJob, createPropertyManager, getManagersByProperty } from "./db";
import { notifyOwner } from "./_core/notification";

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
      .input(z.object({
        zipCode: z.string().min(5).max(10),
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          const job = await createScrapingJob({
            userId: ctx.user.id,
            zipCode: input.zipCode,
            status: 'running',
          });

          (async () => {
            try {
              const properties = await scrapePropertiesForZipCode(input.zipCode);
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
                content: `Scraping job for ZIP code ${input.zipCode} completed successfully. Found ${properties.length} properties with ${totalManagers} property managers.`,
              });

            } catch (error) {
              console.error('[Scraper] Background job failed:', error);
              await updateScrapingJob(job.id, {
                status: 'failed',
                errorMessage: error instanceof Error ? error.message : 'Unknown error',
              });

              await notifyOwner({
                title: 'Property Scraping Failed',
                content: `Scraping job for ZIP code ${input.zipCode} failed. Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              });
            }
          })();

          return {
            jobId: job.id,
            status: job.status,
            zipCode: job.zipCode,
            message: 'Scraping job started. You will be notified when it completes.',
          };
        } catch (error) {
          console.error('[Scraper] Error creating scraping job:', error);
          throw error;
        }
      }),

    getJobHistory: protectedProcedure.query(async ({ ctx }) => {
      return getUserScrapingJobs(ctx.user.id);
    }),

    getJobResults: protectedProcedure
      .input(z.object({
        jobId: z.number(),
      }))
      .query(async ({ ctx, input }) => {
        const jobs = await getUserScrapingJobs(ctx.user.id);
        const jobExists = jobs.some(j => j.id === input.jobId);

        if (!jobExists) {
          throw new Error('Job not found or unauthorized');
        }

        const properties = await getPropertiesByScrapingJob(input.jobId);

        const propertiesWithManagers = await Promise.all(
          properties.map(async (prop) => ({
            ...prop,
            managers: await getManagersByProperty(prop.id),
          }))
        );

        return {
          properties: propertiesWithManagers,
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
