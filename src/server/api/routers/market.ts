import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { getQuote, getTimeSeries, searchMarket } from "@/server/services/market-data";

export const chartRangeSchema = z.enum(["1H", "1D", "1W", "1M", "1Y"]);

export const marketRouter = createTRPCRouter({
  search: protectedProcedure
    .input(z.object({ query: z.string().trim().min(0).max(80) }))
    .query(({ input }) => searchMarket(input.query)),

  quote: protectedProcedure
    .input(z.object({ symbol: z.string().trim().min(1).max(24) }))
    .query(({ input }) => getQuote(input.symbol)),

  timeSeries: protectedProcedure
    .input(
      z.object({
        symbol: z.string().trim().min(1).max(24),
        range: chartRangeSchema,
      }),
    )
    .query(({ input }) => getTimeSeries(input.symbol, input.range)),
});
