import { AssetType, Prisma, TransactionType } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { getQuote } from "@/server/services/market-data";

const assetInput = z.object({
  symbol: z.string().trim().min(1).max(24),
  name: z.string().trim().min(1).max(160),
  type: z.enum(["STOCK", "CRYPTO"]),
  exchange: z.string().trim().max(80).optional(),
  currency: z.string().trim().max(12).default("USD"),
});

const tradeInput = assetInput.extend({
  quantity: z.coerce.number().positive().max(1_000_000_000),
});

function toNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  return value.toNumber();
}

async function getProfile(ctx: {
  prisma: typeof import("@/lib/prisma").prisma;
  userId: string;
}) {
  const profile = await ctx.prisma.profile.findUnique({
    where: { clerkUserId: ctx.userId },
  });

  if (!profile?.isOnboarded) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Complete onboarding before trading.",
    });
  }

  return profile;
}

export const portfolioRouter = createTRPCRouter({
  summary: protectedProcedure.query(async ({ ctx }) => {
    const profile = await getProfile(ctx);
    const [positions, transactions, watchlist] = await Promise.all([
      ctx.prisma.position.findMany({
        where: { profileId: profile.id },
        include: { asset: true },
        orderBy: { updatedAt: "desc" },
      }),
      ctx.prisma.transaction.findMany({
        where: { profileId: profile.id },
        include: { asset: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      ctx.prisma.watchlistItem.findMany({
        where: { profileId: profile.id },
        include: { asset: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const positionsWithQuotes = await Promise.all(
      positions.map(async (position) => {
        const quote = await getQuote(position.asset.symbol);
        const quantity = toNumber(position.quantity);
        const averageCost = toNumber(position.averageCost);
        const marketValue = quantity * quote.price;
        const costBasis = quantity * averageCost;

        return {
          id: position.id,
          symbol: position.asset.symbol,
          name: position.asset.name,
          type: position.asset.type,
          quantity,
          averageCost,
          price: quote.price,
          marketValue,
          gainLoss: marketValue - costBasis,
          gainLossPercent: costBasis > 0 ? (marketValue - costBasis) / costBasis : 0,
        };
      }),
    );

    const watchlistWithQuotes = await Promise.all(
      watchlist.map(async (item) => {
        const quote = await getQuote(item.asset.symbol);
        return {
          id: item.id,
          symbol: item.asset.symbol,
          name: item.asset.name,
          type: item.asset.type,
          price: quote.price,
          changePercent: quote.changePercent,
        };
      }),
    );

    const investedValue = positionsWithQuotes.reduce(
      (total, position) => total + position.marketValue,
      0,
    );
    const cashBalance = toNumber(profile.cashBalance);

    return {
      profile: {
        initialCash: toNumber(profile.initialCash),
        cashBalance,
      },
      totals: {
        cashBalance,
        investedValue,
        totalEquity: cashBalance + investedValue,
        totalGainLoss:
          cashBalance + investedValue - toNumber(profile.initialCash),
      },
      positions: positionsWithQuotes,
      watchlist: watchlistWithQuotes,
      transactions: transactions.map((transaction) => ({
        id: transaction.id,
        symbol: transaction.asset.symbol,
        name: transaction.asset.name,
        type: transaction.type,
        quantity: toNumber(transaction.quantity),
        price: toNumber(transaction.price),
        total: toNumber(transaction.total),
        createdAt: transaction.createdAt.toISOString(),
      })),
    };
  }),

  addToWatchlist: protectedProcedure.input(assetInput).mutation(async ({ ctx, input }) => {
    const profile = await getProfile(ctx);
    const asset = await ctx.prisma.asset.upsert({
      where: { symbol: input.symbol.toUpperCase() },
      create: {
        symbol: input.symbol.toUpperCase(),
        name: input.name,
        type: input.type as AssetType,
        exchange: input.exchange,
        currency: input.currency,
      },
      update: {
        name: input.name,
        type: input.type as AssetType,
        exchange: input.exchange,
        currency: input.currency,
      },
    });

    return ctx.prisma.watchlistItem.upsert({
      where: {
        profileId_assetId: {
          profileId: profile.id,
          assetId: asset.id,
        },
      },
      create: {
        profileId: profile.id,
        assetId: asset.id,
      },
      update: {},
    });
  }),

  buy: protectedProcedure.input(tradeInput).mutation(async ({ ctx, input }) => {
    const profile = await getProfile(ctx);
    const quote = await getQuote(input.symbol);
    const total = quote.price * input.quantity;
    const cashBalance = toNumber(profile.cashBalance);

    if (total > cashBalance) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Not enough cash balance for this order.",
      });
    }

    const symbol = input.symbol.toUpperCase();

    return ctx.prisma.$transaction(async (tx) => {
      const asset = await tx.asset.upsert({
        where: { symbol },
        create: {
          symbol,
          name: input.name,
          type: input.type as AssetType,
          exchange: input.exchange,
          currency: input.currency,
        },
        update: {
          name: input.name,
          type: input.type as AssetType,
          exchange: input.exchange,
          currency: input.currency,
        },
      });

      const existing = await tx.position.findUnique({
        where: {
          profileId_assetId: {
            profileId: profile.id,
            assetId: asset.id,
          },
        },
      });

      if (existing) {
        const oldQuantity = toNumber(existing.quantity);
        const oldAverageCost = toNumber(existing.averageCost);
        const newQuantity = oldQuantity + input.quantity;
        const newAverageCost =
          (oldQuantity * oldAverageCost + total) / newQuantity;

        await tx.position.update({
          where: { id: existing.id },
          data: {
            quantity: newQuantity,
            averageCost: newAverageCost,
          },
        });
      } else {
        await tx.position.create({
          data: {
            profileId: profile.id,
            assetId: asset.id,
            quantity: input.quantity,
            averageCost: quote.price,
          },
        });
      }

      await tx.profile.update({
        where: { id: profile.id },
        data: { cashBalance: cashBalance - total },
      });

      await tx.watchlistItem.upsert({
        where: {
          profileId_assetId: {
            profileId: profile.id,
            assetId: asset.id,
          },
        },
        create: { profileId: profile.id, assetId: asset.id },
        update: {},
      });

      return tx.transaction.create({
        data: {
          profileId: profile.id,
          assetId: asset.id,
          type: TransactionType.BUY,
          quantity: input.quantity,
          price: quote.price,
          total,
        },
      });
    });
  }),

  sell: protectedProcedure.input(tradeInput).mutation(async ({ ctx, input }) => {
    const profile = await getProfile(ctx);
    const quote = await getQuote(input.symbol);
    const symbol = input.symbol.toUpperCase();
    const asset = await ctx.prisma.asset.findUnique({ where: { symbol } });

    if (!asset) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "You do not own this asset.",
      });
    }

    const position = await ctx.prisma.position.findUnique({
      where: {
        profileId_assetId: {
          profileId: profile.id,
          assetId: asset.id,
        },
      },
    });

    const currentQuantity = toNumber(position?.quantity);
    if (!position || currentQuantity < input.quantity) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "You do not have enough quantity to sell.",
      });
    }

    const total = quote.price * input.quantity;
    const remainingQuantity = currentQuantity - input.quantity;

    return ctx.prisma.$transaction(async (tx) => {
      if (remainingQuantity <= 0.0000001) {
        await tx.position.delete({ where: { id: position.id } });
      } else {
        await tx.position.update({
          where: { id: position.id },
          data: { quantity: remainingQuantity },
        });
      }

      await tx.profile.update({
        where: { id: profile.id },
        data: { cashBalance: toNumber(profile.cashBalance) + total },
      });

      return tx.transaction.create({
        data: {
          profileId: profile.id,
          assetId: asset.id,
          type: TransactionType.SELL,
          quantity: input.quantity,
          price: quote.price,
          total,
        },
      });
    });
  }),
});
