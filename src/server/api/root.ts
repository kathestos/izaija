import { createTRPCRouter } from "@/server/api/trpc";
import { marketRouter } from "@/server/api/routers/market";
import { portfolioRouter } from "@/server/api/routers/portfolio";
import { profileRouter } from "@/server/api/routers/profile";

export const appRouter = createTRPCRouter({
  market: marketRouter,
  portfolio: portfolioRouter,
  profile: profileRouter,
});

export type AppRouter = typeof appRouter;
