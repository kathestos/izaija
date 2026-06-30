import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";

export const profileRouter = createTRPCRouter({
  get: protectedProcedure.query(({ ctx }) =>
    ctx.prisma.profile.findUnique({
      where: { clerkUserId: ctx.userId },
    }),
  ),

  completeOnboarding: protectedProcedure
    .input(
      z.object({
        initialCash: z.coerce.number().min(1).max(1_000_000_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.profile.findUnique({
        where: { clerkUserId: ctx.userId },
      });

      if (existing?.isOnboarded) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Onboarding is already complete.",
        });
      }

      return ctx.prisma.profile.upsert({
        where: { clerkUserId: ctx.userId },
        create: {
          clerkUserId: ctx.userId,
          initialCash: input.initialCash,
          cashBalance: input.initialCash,
          isOnboarded: true,
        },
        update: {
          initialCash: input.initialCash,
          cashBalance: input.initialCash,
          isOnboarded: true,
        },
      });
    }),
});
