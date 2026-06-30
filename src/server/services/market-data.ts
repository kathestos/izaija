export type AssetKind = "STOCK" | "CRYPTO";

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
  provider: "twelve-data" | "mock";
};

export type ChartRange = "1H" | "1D" | "1W" | "1M" | "1Y";

export type ChartPoint = {
  time: string;
  price: number;
};

const demoAssets: MarketSearchResult[] = [
  { symbol: "AAPL", name: "Apple Inc.", type: "STOCK", exchange: "NASDAQ", currency: "USD" },
  { symbol: "MSFT", name: "Microsoft Corporation", type: "STOCK", exchange: "NASDAQ", currency: "USD" },
  { symbol: "NVDA", name: "NVIDIA Corporation", type: "STOCK", exchange: "NASDAQ", currency: "USD" },
  { symbol: "TSLA", name: "Tesla, Inc.", type: "STOCK", exchange: "NASDAQ", currency: "USD" },
  { symbol: "AMZN", name: "Amazon.com, Inc.", type: "STOCK", exchange: "NASDAQ", currency: "USD" },
  { symbol: "BTC/USD", name: "Bitcoin / US Dollar", type: "CRYPTO", exchange: "Crypto", currency: "USD" },
  { symbol: "ETH/USD", name: "Ethereum / US Dollar", type: "CRYPTO", exchange: "Crypto", currency: "USD" },
  { symbol: "SOL/USD", name: "Solana / US Dollar", type: "CRYPTO", exchange: "Crypto", currency: "USD" },
];

const rangeConfig: Record<ChartRange, { interval: string; outputsize: number; mockStepMs: number }> = {
  "1H": { interval: "1min", outputsize: 60, mockStepMs: 60_000 },
  "1D": { interval: "5min", outputsize: 288, mockStepMs: 5 * 60_000 },
  "1W": { interval: "1h", outputsize: 168, mockStepMs: 60 * 60_000 },
  "1M": { interval: "1day", outputsize: 31, mockStepMs: 24 * 60 * 60_000 },
  "1Y": { interval: "1week", outputsize: 52, mockStepMs: 7 * 24 * 60 * 60_000 },
};

const apiBase = "https://api.twelvedata.com";

function apiKey() {
  return process.env.TWELVE_DATA_API_KEY?.trim();
}

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

function classifyAsset(symbol: string, instrumentType?: string): AssetKind {
  if (symbol.includes("/") || instrumentType?.toLowerCase().includes("crypto")) {
    return "CRYPTO";
  }

  return "STOCK";
}

function fallbackAsset(symbol: string): MarketSearchResult {
  const normalized = normalizeSymbol(symbol);
  return (
    demoAssets.find((asset) => asset.symbol === normalized) ?? {
      symbol: normalized,
      name: normalized,
      type: normalized.includes("/") ? "CRYPTO" : "STOCK",
      exchange: normalized.includes("/") ? "Crypto" : "Market",
      currency: "USD",
    }
  );
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

function hashSymbol(symbol: string) {
  return [...symbol].reduce((total, char) => total + char.charCodeAt(0), 0);
}

function mockBasePrice(symbol: string) {
  const hash = hashSymbol(symbol);
  if (symbol.includes("BTC")) return 62_000 + (hash % 9_000);
  if (symbol.includes("ETH")) return 3_000 + (hash % 800);
  if (symbol.includes("SOL")) return 110 + (hash % 90);
  return 45 + (hash % 420);
}

function mockQuote(symbol: string): MarketQuote {
  const asset = fallbackAsset(symbol);
  const hash = hashSymbol(asset.symbol);
  const wave = Math.sin(Date.now() / 900_000 + hash);
  const price = mockBasePrice(asset.symbol) * (1 + wave * 0.015);
  const previousClose = price * (1 - wave * 0.01);
  const change = price - previousClose;

  return {
    ...asset,
    price,
    change,
    changePercent: previousClose ? change / previousClose : 0,
    previousClose,
    timestamp: new Date().toISOString(),
    provider: "mock",
  };
}

function mockSeries(symbol: string, range: ChartRange): ChartPoint[] {
  const { outputsize, mockStepMs } = rangeConfig[range];
  const base = mockBasePrice(symbol);
  const hash = hashSymbol(symbol);
  const now = Date.now();

  return Array.from({ length: outputsize }, (_, index) => {
    const reverseIndex = outputsize - index - 1;
    const time = new Date(now - reverseIndex * mockStepMs);
    const drift = (index / outputsize - 0.5) * 0.04;
    const wave = Math.sin(index / 5 + hash) * 0.025;

    return {
      time: time.toISOString(),
      price: Math.max(0.01, base * (1 + drift + wave)),
    };
  });
}

async function getJson<T>(url: URL): Promise<T | null> {
  const response = await fetch(url, {
    next: { revalidate: 30 },
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as T & { status?: string; message?: string };
  if (data.status === "error") {
    return null;
  }

  return data;
}

export async function searchMarket(query: string): Promise<MarketSearchResult[]> {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2) {
    return demoAssets;
  }

  const key = apiKey();
  if (!key) {
    return searchMarketWithoutApi(normalizedQuery);
  }

  const url = new URL(`${apiBase}/symbol_search`);
  url.searchParams.set("symbol", normalizedQuery);
  url.searchParams.set("apikey", key);

  const data = await getJson<{
    data?: Array<{
      symbol?: string;
      instrument_name?: string;
      exchange?: string;
      currency?: string;
      instrument_type?: string;
    }>;
  }>(url);

  const results = uniqueSearchResults(
    data?.data
      ?.filter((item) => item.symbol)
      .map((item) => ({
        symbol: normalizeSymbol(item.symbol ?? ""),
        name: item.instrument_name || item.symbol || "Unknown asset",
        type: classifyAsset(item.symbol ?? "", item.instrument_type),
        exchange: item.exchange,
        currency: item.currency || "USD",
      })) ?? [],
  ).slice(0, 12);

  return results.length ? results : searchMarketWithoutApi(normalizedQuery);
}

function searchMarketWithoutApi(query: string) {
  return uniqueSearchResults(
    demoAssets.filter((asset) => {
      const haystack = `${asset.symbol} ${asset.name}`.toLowerCase();
      return haystack.includes(query.toLowerCase());
    }),
  );
}

export async function getQuote(symbol: string): Promise<MarketQuote> {
  const normalized = normalizeSymbol(symbol);
  const key = apiKey();

  if (!key) {
    return mockQuote(normalized);
  }

  const url = new URL(`${apiBase}/quote`);
  url.searchParams.set("symbol", normalized);
  url.searchParams.set("apikey", key);

  const data = await getJson<{
    symbol?: string;
    name?: string;
    exchange?: string;
    currency?: string;
    close?: string;
    price?: string;
    previous_close?: string;
    change?: string;
    percent_change?: string;
  }>(url);

  const price = Number(data?.close ?? data?.price);
  if (!data || !Number.isFinite(price) || price <= 0) {
    return mockQuote(normalized);
  }

  const previousClose = Number(data.previous_close);
  const change = Number(data.change);
  const changePercent = Number(data.percent_change);
  const fallback = fallbackAsset(normalized);

  return {
    symbol: normalizeSymbol(data.symbol ?? normalized),
    name: data.name || fallback.name,
    type: classifyAsset(data.symbol ?? normalized),
    exchange: data.exchange || fallback.exchange,
    currency: data.currency || fallback.currency,
    price,
    previousClose: Number.isFinite(previousClose) ? previousClose : undefined,
    change: Number.isFinite(change)
      ? change
      : Number.isFinite(previousClose)
        ? price - previousClose
        : 0,
    changePercent: Number.isFinite(changePercent)
      ? changePercent / 100
      : Number.isFinite(previousClose) && previousClose > 0
        ? (price - previousClose) / previousClose
        : 0,
    timestamp: new Date().toISOString(),
    provider: "twelve-data",
  };
}

export async function getTimeSeries(
  symbol: string,
  range: ChartRange,
): Promise<ChartPoint[]> {
  const normalized = normalizeSymbol(symbol);
  const key = apiKey();
  const config = rangeConfig[range];

  if (!key) {
    return mockSeries(normalized, range);
  }

  const url = new URL(`${apiBase}/time_series`);
  url.searchParams.set("symbol", normalized);
  url.searchParams.set("interval", config.interval);
  url.searchParams.set("outputsize", String(config.outputsize));
  url.searchParams.set("apikey", key);

  const data = await getJson<{
    values?: Array<{ datetime?: string; close?: string }>;
  }>(url);

  const values =
    data?.values
      ?.map((item) => ({
        time: item.datetime ?? new Date().toISOString(),
        price: Number(item.close),
      }))
      .filter((point) => Number.isFinite(point.price))
      .reverse() ?? [];

  return values.length ? values : mockSeries(normalized, range);
}
