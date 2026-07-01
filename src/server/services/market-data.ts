import { AssetType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type AssetKind = "STOCK" | "CRYPTO";
export type MarketDataProvider = "alpaca" | "binance";

export type MarketSearchResult = {
  symbol: string;
  name: string;
  type: AssetKind;
  exchange?: string;
  currency: string;
};

export type MarketQuote = MarketSearchResult & {
  price: number;
  change: number;
  changePercent: number;
  previousClose?: number;
  timestamp: string;
  provider: MarketDataProvider;
  cached: boolean;
};

export type ChartRange = "1H" | "1D" | "1W" | "1M" | "1Y";

export type ChartPoint = {
  time: string;
  price: number;
};

type AlpacaAsset = {
  symbol?: string;
  name?: string;
  exchange?: string;
  status?: string;
  tradable?: boolean;
  asset_class?: string;
};

type AlpacaBar = {
  t?: string;
  c?: number;
};

type BinanceTicker = {
  symbol: string;
  price: string;
};

const QUOTE_CACHE_MS = 60_000;
const SERIES_CACHE_MS = 5 * 60_000;
const SEARCH_CACHE_MS = 15 * 60_000;

const ALPACA_TRADING_BASE = "https://paper-api.alpaca.markets";
const ALPACA_DATA_BASE = "https://data.alpaca.markets";
const BINANCE_BASE = "https://api.binance.com";

const rangeConfig: Record<
  ChartRange,
  { alpacaTimeframe: string; binanceInterval: string; outputsize: number }
> = {
  "1H": { alpacaTimeframe: "1Min", binanceInterval: "1m", outputsize: 60 },
  "1D": { alpacaTimeframe: "5Min", binanceInterval: "5m", outputsize: 288 },
  "1W": { alpacaTimeframe: "1Hour", binanceInterval: "1h", outputsize: 168 },
  "1M": { alpacaTimeframe: "1Day", binanceInterval: "1d", outputsize: 31 },
  "1Y": { alpacaTimeframe: "1Week", binanceInterval: "1w", outputsize: 52 },
};

const cryptoNames: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
  BNB: "BNB",
  XRP: "XRP",
  ADA: "Cardano",
  DOGE: "Dogecoin",
  AVAX: "Avalanche",
  LINK: "Chainlink",
  DOT: "Polkadot",
  LTC: "Litecoin",
  BCH: "Bitcoin Cash",
  MATIC: "Polygon",
  TRX: "TRON",
  UNI: "Uniswap",
};

let alpacaAssetCache: { expiresAt: number; assets: MarketSearchResult[] } | null =
  null;
let binanceTickerCache: { expiresAt: number; tickers: BinanceTicker[] } | null =
  null;

export class MarketDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketDataError";
  }
}

function alpacaCredentials() {
  const keyId =
    process.env.ALPACA_API_KEY_ID?.trim() ||
    process.env.APCA_API_KEY_ID?.trim();
  const secretKey =
    process.env.ALPACA_API_SECRET_KEY?.trim() ||
    process.env.APCA_API_SECRET_KEY?.trim();

  if (!keyId || !secretKey) return null;
  return { keyId, secretKey };
}

function alpacaHeaders() {
  const credentials = alpacaCredentials();
  if (!credentials) {
    throw new MarketDataError(
      "Stock market data needs ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY.",
    );
  }

  return {
    "APCA-API-KEY-ID": credentials.keyId,
    "APCA-API-SECRET-KEY": credentials.secretKey,
  };
}

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

function isCryptoSymbol(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  return normalized.includes("/") || normalized.endsWith("USDT");
}

function toBinanceSymbol(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  if (normalized.includes("/")) {
    const [base, quote] = normalized.split("/");
    return `${base}${quote === "USD" ? "USDT" : quote}`;
  }

  if (normalized.endsWith("USDT")) return normalized;
  return `${normalized}USDT`;
}

function fromBinanceSymbol(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  if (normalized.endsWith("USDT")) {
    return `${normalized.slice(0, -4)}/USD`;
  }

  return normalized;
}

function cryptoDisplayName(symbol: string) {
  const base = fromBinanceSymbol(symbol).split("/")[0];
  return `${cryptoNames[base] ?? base} / US Dollar`;
}

function toNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  return value.toNumber();
}

function isFresh(date: Date, ttlMs: number) {
  return Date.now() - date.getTime() < ttlMs;
}

async function fetchJson<T>(url: URL, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
  });

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message =
      typeof body === "object" && body && "message" in body
        ? String((body as { message?: unknown }).message)
        : response.statusText;
    throw new MarketDataError(`Market data request failed: ${message}`);
  }

  if (
    typeof body === "object" &&
    body &&
    "code" in body &&
    "msg" in body
  ) {
    throw new MarketDataError(String((body as { msg?: unknown }).msg));
  }

  return body as T;
}

function searchResultKey(asset: MarketSearchResult) {
  return [
    asset.symbol,
    asset.type,
    asset.exchange ?? "",
    asset.currency,
    asset.name,
  ].join("|");
}

function uniqueSearchResults(results: MarketSearchResult[]) {
  const seen = new Set<string>();

  return results.filter((asset) => {
    const key = searchResultKey(asset);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getAlpacaAssets() {
  if (alpacaAssetCache && alpacaAssetCache.expiresAt > Date.now()) {
    return alpacaAssetCache.assets;
  }

  if (!alpacaCredentials()) return [];

  const url = new URL(`${ALPACA_TRADING_BASE}/v2/assets`);
  url.searchParams.set("status", "active");
  url.searchParams.set("asset_class", "us_equity");

  const data = await fetchJson<AlpacaAsset[]>(url, {
    headers: alpacaHeaders(),
  });

  const assets = uniqueSearchResults(
    data
      .filter((asset) => asset.symbol && asset.name)
      .filter((asset) => asset.status === "active")
      .filter((asset) => asset.asset_class === "us_equity")
      .filter((asset) => asset.tradable !== false)
      .map((asset) => ({
        symbol: normalizeSymbol(asset.symbol ?? ""),
        name: asset.name ?? asset.symbol ?? "Unknown stock",
        type: "STOCK" as const,
        exchange: asset.exchange,
        currency: "USD",
      })),
  );

  alpacaAssetCache = {
    assets,
    expiresAt: Date.now() + SEARCH_CACHE_MS,
  };

  return assets;
}

async function getBinanceTickers() {
  if (binanceTickerCache && binanceTickerCache.expiresAt > Date.now()) {
    return binanceTickerCache.tickers;
  }

  const url = new URL(`${BINANCE_BASE}/api/v3/ticker/price`);
  const tickers = await fetchJson<BinanceTicker[]>(url);
  binanceTickerCache = {
    tickers,
    expiresAt: Date.now() + SEARCH_CACHE_MS,
  };

  return tickers;
}

async function searchStocks(query: string) {
  const assets = await getAlpacaAssets();
  const normalizedQuery = query.toUpperCase();
  const lowerQuery = query.toLowerCase();

  return assets
    .filter((asset) => {
      return (
        asset.symbol.includes(normalizedQuery) ||
        asset.name.toLowerCase().includes(lowerQuery)
      );
    })
    .slice(0, 12);
}

async function searchCrypto(query: string) {
  const normalizedQuery = query.toUpperCase().replace("/", "");
  const lowerQuery = query.toLowerCase();
  const tickers = await getBinanceTickers();

  return uniqueSearchResults(
    tickers
      .filter((ticker) => ticker.symbol.endsWith("USDT"))
      .map((ticker) => {
        const symbol = fromBinanceSymbol(ticker.symbol);
        return {
          symbol,
          name: cryptoDisplayName(ticker.symbol),
          type: "CRYPTO" as const,
          exchange: "Binance",
          currency: "USD",
        };
      })
      .filter((asset) => {
        const base = asset.symbol.split("/")[0];
        return (
          asset.symbol.replace("/", "").includes(normalizedQuery) ||
          base.includes(normalizedQuery) ||
          asset.name.toLowerCase().includes(lowerQuery)
        );
      }),
  ).slice(0, 12);
}

export async function searchMarket(query: string): Promise<MarketSearchResult[]> {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2) return [];

  const [stockResults, cryptoResults] = await Promise.allSettled([
    searchStocks(normalizedQuery),
    searchCrypto(normalizedQuery),
  ]);

  return uniqueSearchResults([
    ...(stockResults.status === "fulfilled" ? stockResults.value : []),
    ...(cryptoResults.status === "fulfilled" ? cryptoResults.value : []),
  ]).slice(0, 12);
}

function quoteFromCache(
  cache: NonNullable<Awaited<ReturnType<typeof prisma.marketQuoteCache.findUnique>>>,
): MarketQuote {
  return {
    symbol: cache.symbol,
    name: cache.name,
    type: cache.type,
    exchange: cache.exchange ?? undefined,
    currency: cache.currency,
    provider: cache.provider as MarketDataProvider,
    price: toNumber(cache.price),
    change: toNumber(cache.change),
    changePercent: toNumber(cache.changePercent),
    previousClose:
      cache.previousClose === null ? undefined : toNumber(cache.previousClose),
    timestamp: (cache.sourceTimestamp ?? cache.cachedAt).toISOString(),
    cached: true,
  };
}

async function getCachedQuote(symbol: string, ttlMs?: number) {
  const cache = await prisma.marketQuoteCache.findUnique({
    where: { symbol },
  });

  if (!cache) return null;
  if (ttlMs !== undefined && !isFresh(cache.cachedAt, ttlMs)) return null;
  return quoteFromCache(cache);
}

async function saveQuote(quote: MarketQuote) {
  await prisma.marketQuoteCache.upsert({
    where: { symbol: quote.symbol },
    create: {
      symbol: quote.symbol,
      name: quote.name,
      type: quote.type as AssetType,
      exchange: quote.exchange,
      currency: quote.currency,
      provider: quote.provider,
      price: quote.price,
      change: quote.change,
      changePercent: quote.changePercent,
      previousClose: quote.previousClose,
      sourceTimestamp: new Date(quote.timestamp),
      cachedAt: new Date(),
    },
    update: {
      name: quote.name,
      type: quote.type as AssetType,
      exchange: quote.exchange,
      currency: quote.currency,
      provider: quote.provider,
      price: quote.price,
      change: quote.change,
      changePercent: quote.changePercent,
      previousClose: quote.previousClose,
      sourceTimestamp: new Date(quote.timestamp),
      cachedAt: new Date(),
    },
  });
}

async function fetchAlpacaQuote(symbol: string): Promise<MarketQuote> {
  const normalized = normalizeSymbol(symbol);
  const url = new URL(`${ALPACA_DATA_BASE}/v2/stocks/${normalized}/snapshot`);
  url.searchParams.set("feed", "iex");

  const data = await fetchJson<{
    symbol?: string;
    latestTrade?: { p?: number; t?: string };
    minuteBar?: { c?: number; t?: string };
    dailyBar?: { c?: number; t?: string };
    prevDailyBar?: { c?: number; t?: string };
  }>(url, {
    headers: alpacaHeaders(),
  });

  const price = Number(
    data.minuteBar?.c ?? data.latestTrade?.p ?? data.dailyBar?.c,
  );
  if (!Number.isFinite(price) || price <= 0) {
    throw new MarketDataError(`No stock quote is available for ${normalized}.`);
  }

  const previousClose = Number(data.prevDailyBar?.c);
  const change = Number.isFinite(previousClose) ? price - previousClose : 0;
  const sourceTimestamp =
    data.minuteBar?.t ?? data.latestTrade?.t ?? data.dailyBar?.t;

  return {
    symbol: normalized,
    name: normalized,
    type: "STOCK",
    exchange: "Alpaca IEX",
    currency: "USD",
    provider: "alpaca",
    price,
    previousClose: Number.isFinite(previousClose) ? previousClose : undefined,
    change,
    changePercent:
      Number.isFinite(previousClose) && previousClose > 0
        ? change / previousClose
        : 0,
    timestamp: sourceTimestamp
      ? new Date(sourceTimestamp).toISOString()
      : new Date().toISOString(),
    cached: false,
  };
}

async function fetchBinanceQuote(symbol: string): Promise<MarketQuote> {
  const binanceSymbol = toBinanceSymbol(symbol);
  const appSymbol = fromBinanceSymbol(binanceSymbol);
  const url = new URL(`${BINANCE_BASE}/api/v3/ticker/24hr`);
  url.searchParams.set("symbol", binanceSymbol);

  const data = await fetchJson<{
    lastPrice?: string;
    priceChange?: string;
    priceChangePercent?: string;
    closeTime?: number;
  }>(url);

  const price = Number(data.lastPrice);
  if (!Number.isFinite(price) || price <= 0) {
    throw new MarketDataError(`No crypto quote is available for ${appSymbol}.`);
  }

  const change = Number(data.priceChange);
  const changePercent = Number(data.priceChangePercent);

  return {
    symbol: appSymbol,
    name: cryptoDisplayName(binanceSymbol),
    type: "CRYPTO",
    exchange: "Binance",
    currency: "USD",
    provider: "binance",
    price,
    change: Number.isFinite(change) ? change : 0,
    changePercent: Number.isFinite(changePercent) ? changePercent / 100 : 0,
    previousClose: Number.isFinite(change) ? price - change : undefined,
    timestamp: data.closeTime
      ? new Date(data.closeTime).toISOString()
      : new Date().toISOString(),
    cached: false,
  };
}

export async function getQuote(symbol: string): Promise<MarketQuote> {
  const normalized = normalizeSymbol(symbol);
  const cachedQuote = await getCachedQuote(normalized, QUOTE_CACHE_MS);
  if (cachedQuote) return cachedQuote;

  try {
    const quote = isCryptoSymbol(normalized)
      ? await fetchBinanceQuote(normalized)
      : await fetchAlpacaQuote(normalized);
    await saveQuote(quote);
    return quote;
  } catch (error) {
    const staleQuote = await getCachedQuote(normalized);
    if (staleQuote) return staleQuote;
    throw error;
  }
}

function chartPointsFromCache(points: Prisma.JsonValue): ChartPoint[] | null {
  if (!Array.isArray(points)) return null;

  const chartPoints = points
    .map((point) => {
      if (!point || typeof point !== "object") return null;
      const record = point as { time?: unknown; price?: unknown };
      const time = typeof record.time === "string" ? record.time : null;
      const price = Number(record.price);
      if (!time || !Number.isFinite(price)) return null;
      return { time, price };
    })
    .filter((point): point is ChartPoint => Boolean(point));

  return chartPoints.length ? chartPoints : null;
}

async function getCachedSeries(symbol: string, range: ChartRange, ttlMs?: number) {
  const cache = await prisma.marketSeriesCache.findUnique({
    where: { symbol_range: { symbol, range } },
  });

  if (!cache) return null;
  if (ttlMs !== undefined && !isFresh(cache.cachedAt, ttlMs)) return null;
  return chartPointsFromCache(cache.points);
}

async function saveSeries(
  symbol: string,
  range: ChartRange,
  provider: MarketDataProvider,
  points: ChartPoint[],
) {
  await prisma.marketSeriesCache.upsert({
    where: { symbol_range: { symbol, range } },
    create: {
      symbol,
      range,
      provider,
      points: points as unknown as Prisma.InputJsonValue,
      cachedAt: new Date(),
    },
    update: {
      provider,
      points: points as unknown as Prisma.InputJsonValue,
      cachedAt: new Date(),
    },
  });
}

async function fetchAlpacaSeries(
  symbol: string,
  range: ChartRange,
): Promise<ChartPoint[]> {
  const normalized = normalizeSymbol(symbol);
  const config = rangeConfig[range];
  const url = new URL(`${ALPACA_DATA_BASE}/v2/stocks/${normalized}/bars`);
  url.searchParams.set("timeframe", config.alpacaTimeframe);
  url.searchParams.set("limit", String(config.outputsize));
  url.searchParams.set("feed", "iex");
  url.searchParams.set("adjustment", "raw");
  url.searchParams.set("sort", "asc");

  const data = await fetchJson<{ bars?: AlpacaBar[] | Record<string, AlpacaBar[]> }>(
    url,
    { headers: alpacaHeaders() },
  );

  const bars = Array.isArray(data.bars)
    ? data.bars
    : data.bars?.[normalized] ?? [];
  const points = bars
    .map((bar) => ({
      time: bar.t ? new Date(bar.t).toISOString() : "",
      price: Number(bar.c),
    }))
    .filter((point) => point.time && Number.isFinite(point.price));

  if (!points.length) {
    throw new MarketDataError(`No stock chart data is available for ${normalized}.`);
  }

  return points;
}

async function fetchBinanceSeries(
  symbol: string,
  range: ChartRange,
): Promise<ChartPoint[]> {
  const binanceSymbol = toBinanceSymbol(symbol);
  const config = rangeConfig[range];
  const url = new URL(`${BINANCE_BASE}/api/v3/klines`);
  url.searchParams.set("symbol", binanceSymbol);
  url.searchParams.set("interval", config.binanceInterval);
  url.searchParams.set("limit", String(config.outputsize));

  const data = await fetchJson<Array<[number, string, string, string, string]>>(url);
  const points = data
    .map((item) => ({
      time: new Date(item[0]).toISOString(),
      price: Number(item[4]),
    }))
    .filter((point) => Number.isFinite(point.price));

  if (!points.length) {
    throw new MarketDataError(`No crypto chart data is available for ${fromBinanceSymbol(binanceSymbol)}.`);
  }

  return points;
}

export async function getTimeSeries(
  symbol: string,
  range: ChartRange,
): Promise<ChartPoint[]> {
  const normalized = normalizeSymbol(symbol);
  const cachedSeries = await getCachedSeries(normalized, range, SERIES_CACHE_MS);
  if (cachedSeries) return cachedSeries;

  try {
    const provider: MarketDataProvider = isCryptoSymbol(normalized)
      ? "binance"
      : "alpaca";
    const points =
      provider === "binance"
        ? await fetchBinanceSeries(normalized, range)
        : await fetchAlpacaSeries(normalized, range);

    await saveSeries(normalized, range, provider, points);
    return points;
  } catch (error) {
    const staleSeries = await getCachedSeries(normalized, range);
    if (staleSeries) return staleSeries;
    throw error;
  }
}
