-- CreateTable
CREATE TABLE "MarketQuoteCache" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AssetType" NOT NULL,
    "exchange" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "provider" TEXT NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "change" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "changePercent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "previousClose" DECIMAL(65,30),
    "sourceTimestamp" TIMESTAMP(3),
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketQuoteCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSeriesCache" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "range" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "points" JSONB NOT NULL,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketSeriesCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketQuoteCache_symbol_key" ON "MarketQuoteCache"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSeriesCache_symbol_range_key" ON "MarketSeriesCache"("symbol", "range");
