"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  History,
  Loader2,
  Search,
  TrendingUp,
  UserRound,
  Wallet,
} from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { FormEvent, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency, formatPercent, formatQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/client";

type AssetSelection = {
  symbol: string;
  name: string;
  type: "STOCK" | "CRYPTO";
  exchange?: string;
  currency: string;
};

type ChartRange = "1H" | "1D" | "1W" | "1M" | "1Y";

const ranges: ChartRange[] = ["1H", "1D", "1W", "1M", "1Y"];

const defaultSelection: AssetSelection = {
  symbol: "AAPL",
  name: "Apple Inc.",
  type: "STOCK",
  exchange: "NASDAQ",
  currency: "USD",
};

type MarketListAsset = {
  id?: string;
  symbol: string;
  name: string;
  type: "STOCK" | "CRYPTO";
  exchange?: string | null;
  currency?: string | null;
};

function marketListKey(asset: MarketListAsset, index: number) {
  return [
    asset.id,
    asset.symbol,
    asset.type,
    asset.exchange ?? "",
    asset.currency ?? "USD",
    asset.name,
    index,
  ]
    .filter(Boolean)
    .join("|");
}

function providerLabel(provider?: "alpaca" | "binance", cached?: boolean) {
  if (!provider) return "market data";
  const label = provider === "alpaca" ? "Alpaca" : "Binance";
  return cached ? `${label} cached data` : label;
}

function nullableCurrency(value: number | null | undefined) {
  return value === null || value === undefined ? "Unavailable" : formatCurrency(value);
}

function nullablePercent(value: number | null | undefined) {
  return value === null || value === undefined ? "Unavailable" : formatPercent(value);
}

export function DashboardClient({ userName }: { userName: string }) {
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [selectedAsset, setSelectedAsset] =
    useState<AssetSelection>(defaultSelection);
  const [range, setRange] = useState<ChartRange>("1D");
  const [quantity, setQuantity] = useState("1");
  const [message, setMessage] = useState<string | null>(null);

  const summary = trpc.portfolio.summary.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  const search = trpc.market.search.useQuery(
    { query },
    { enabled: query.trim().length >= 2, refetchOnWindowFocus: false },
  );
  const quote = trpc.market.quote.useQuery(
    { symbol: selectedAsset.symbol },
    {
      enabled: Boolean(selectedAsset.symbol),
      refetchInterval: 60_000,
      refetchOnWindowFocus: false,
    },
  );
  const series = trpc.market.timeSeries.useQuery(
    { symbol: selectedAsset.symbol, range },
    {
      enabled: Boolean(selectedAsset.symbol),
      refetchInterval: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  );

  const addToWatchlist = trpc.portfolio.addToWatchlist.useMutation({
    onSuccess: async () => {
      setMessage(`${selectedAsset.symbol} added to watchlist.`);
      await utils.portfolio.summary.invalidate();
    },
  });

  const buy = trpc.portfolio.buy.useMutation({
    onSuccess: async () => {
      setMessage(`Bought ${quantity} ${selectedAsset.symbol}.`);
      await utils.portfolio.summary.invalidate();
    },
    onError: (error) => setMessage(error.message),
  });

  const sell = trpc.portfolio.sell.useMutation({
    onSuccess: async () => {
      setMessage(`Sold ${quantity} ${selectedAsset.symbol}.`);
      await utils.portfolio.summary.invalidate();
    },
    onError: (error) => setMessage(error.message),
  });

  const chartData = useMemo(
    () =>
      (series.data ?? []).map((point) => ({
        ...point,
        label: new Date(point.time).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      })),
    [series.data],
  );

  function selectAsset(asset: AssetSelection) {
    setSelectedAsset(asset);
    setMessage(null);
  }

  function currentOrder() {
    return {
      ...selectedAsset,
      quantity: Number(quantity),
    };
  }

  function onTrade(event: FormEvent<HTMLFormElement>, side: "buy" | "sell") {
    event.preventDefault();
    setMessage(null);

    if (side === "buy") {
      buy.mutate(currentOrder());
    } else {
      sell.mutate(currentOrder());
    }
  }

  const totals = summary.data?.totals;
  const isTrading = buy.isPending || sell.isPending;

  return (
    <main className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-6">
          <div>
            <p className="text-sm text-muted-foreground">Izaija</p>
            <h1 className="text-2xl font-semibold">Mock investment dashboard</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground sm:flex">
              <UserRound className="size-4" aria-hidden="true" />
              <span className="max-w-48 truncate">{userName}</span>
            </div>
            <UserButton signInUrl="/sign-in" />
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-6">
        <section className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={<Wallet className="size-4" aria-hidden="true" />}
              label="Cash balance"
              value={formatCurrency(totals?.cashBalance ?? 0)}
            />
            <MetricCard
              icon={<TrendingUp className="size-4" aria-hidden="true" />}
              label="Invested value"
              value={formatCurrency(totals?.investedValue ?? 0)}
            />
            <MetricCard
              icon={<ArrowUpRight className="size-4" aria-hidden="true" />}
              label="Total equity"
              value={formatCurrency(totals?.totalEquity ?? 0)}
            />
            <MetricCard
              icon={<History className="size-4" aria-hidden="true" />}
              label="All-time result"
              value={formatCurrency(totals?.totalGainLoss ?? 0)}
              valueClassName={
                (totals?.totalGainLoss ?? 0) >= 0 ? "text-profit" : "text-loss"
              }
            />
          </div>

          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>{selectedAsset.symbol} price chart</CardTitle>
                <CardDescription>
                  {selectedAsset.name} using {providerLabel(quote.data?.provider, quote.data?.cached)}
                </CardDescription>
              </div>
              <Tabs value={range} onValueChange={(value) => setRange(value as ChartRange)}>
                <TabsList>
                  {ranges.map((item) => (
                    <TabsTrigger key={item} value={item}>
                      {item}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent>
              <div className="h-[320px] w-full">
                {series.error ? (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                    {series.error.message}
                  </div>
                ) : series.isLoading ? (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                    Loading chart
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ left: 4, right: 12, top: 8 }}>
                      <defs>
                        <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0f766e" stopOpacity={0.24} />
                          <stop offset="95%" stopColor="#0f766e" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#e4e6e1" vertical={false} />
                      <XAxis dataKey="label" minTickGap={36} tick={{ fontSize: 12 }} />
                      <YAxis
                        domain={["dataMin", "dataMax"]}
                        tick={{ fontSize: 12 }}
                        tickFormatter={(value) => `$${Number(value).toFixed(0)}`}
                        width={64}
                      />
                      <Tooltip
                        formatter={(value) => [formatCurrency(Number(value)), "Price"]}
                        labelClassName="text-foreground"
                      />
                      <Area
                        dataKey="price"
                        fill="url(#priceFill)"
                        stroke="#0f766e"
                        strokeWidth={2}
                        type="monotone"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Wallet</CardTitle>
              <CardDescription>Open mock positions with cached market marks.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="border-b text-left text-muted-foreground">
                    <tr>
                      <th className="py-3 pr-3 font-medium">Asset</th>
                      <th className="py-3 pr-3 font-medium">Quantity</th>
                      <th className="py-3 pr-3 font-medium">Average cost</th>
                      <th className="py-3 pr-3 font-medium">Price</th>
                      <th className="py-3 pr-3 font-medium">Value</th>
                      <th className="py-3 pr-3 font-medium">P/L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.data?.positions.length ? (
                      summary.data.positions.map((position) => (
                        <tr
                          key={position.id}
                          className="cursor-pointer border-b last:border-0 hover:bg-muted/50"
                          onClick={() =>
                            selectAsset({
                              symbol: position.symbol,
                              name: position.name,
                              type: position.type,
                              currency: "USD",
                            })
                          }
                        >
                          <td className="py-3 pr-3">
                            <div className="font-medium">{position.symbol}</div>
                            <div className="text-xs text-muted-foreground">
                              {position.name}
                            </div>
                          </td>
                          <td className="py-3 pr-3">{formatQuantity(position.quantity)}</td>
                          <td className="py-3 pr-3">{formatCurrency(position.averageCost)}</td>
                          <td className="py-3 pr-3">{nullableCurrency(position.price)}</td>
                          <td className="py-3 pr-3">{nullableCurrency(position.marketValue)}</td>
                          <td
                            className={cn(
                              "py-3 pr-3 font-medium",
                              (position.gainLoss ?? 0) >= 0 ? "text-profit" : "text-loss",
                            )}
                          >
                            {nullableCurrency(position.gainLoss)}
                            <span className="ml-1 text-xs">
                              ({nullablePercent(position.gainLossPercent)})
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="py-8 text-center text-muted-foreground" colSpan={6}>
                          Search for an asset and make your first mock buy.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Investment history</CardTitle>
              <CardDescription>Your latest buys and sells.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {summary.data?.transactions.length ? (
                  summary.data.transactions.map((transaction) => (
                    <div
                      key={transaction.id}
                      className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-[120px_1fr_auto]"
                    >
                      <div
                        className={cn(
                          "flex items-center gap-2 font-medium",
                          transaction.type === "BUY" ? "text-profit" : "text-loss",
                        )}
                      >
                        {transaction.type === "BUY" ? (
                          <ArrowUpRight className="size-4" aria-hidden="true" />
                        ) : (
                          <ArrowDownRight className="size-4" aria-hidden="true" />
                        )}
                        {transaction.type}
                      </div>
                      <div>
                        <div className="font-medium">{transaction.symbol}</div>
                        <div className="text-muted-foreground">
                          {formatQuantity(transaction.quantity)} at{" "}
                          {formatCurrency(transaction.price)}
                        </div>
                      </div>
                      <div className="text-left font-medium sm:text-right">
                        <div>{formatCurrency(transaction.total)}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(transaction.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No investment history yet.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </section>

        <aside className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Search markets</CardTitle>
              <CardDescription>Find stocks or crypto, then trade with virtual money.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search AAPL, Tesla, BTC..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {search.isFetching ? (
                  <div className="flex items-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                    Searching
                  </div>
                ) : null}
                {(query.trim().length >= 2 ? search.data ?? [] : summary.data?.watchlist ?? [])
                  .slice(0, 8)
                  .map((asset, index) => (
                    <button
                      key={marketListKey(asset, index)}
                      className={cn(
                        "w-full rounded-md border p-3 text-left transition-colors hover:bg-muted",
                        selectedAsset.symbol === asset.symbol &&
                          selectedAsset.type === asset.type &&
                          selectedAsset.exchange ===
                            ("exchange" in asset ? asset.exchange ?? undefined : undefined) &&
                          "border-primary",
                      )}
                      onClick={() =>
                        selectAsset({
                          symbol: asset.symbol,
                          name: asset.name,
                          type: asset.type,
                          currency: "currency" in asset ? asset.currency ?? "USD" : "USD",
                          exchange: "exchange" in asset ? asset.exchange ?? undefined : undefined,
                        })
                      }
                      type="button"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{asset.symbol}</span>
                        <span className="rounded-sm bg-muted px-2 py-1 text-xs text-muted-foreground">
                          {asset.type}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-sm text-muted-foreground">
                        {asset.name}
                      </div>
                      {"exchange" in asset && asset.exchange ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {asset.exchange} - {asset.currency}
                        </div>
                      ) : null}
                    </button>
                  ))}
                {query.trim().length >= 2 && !search.isFetching && !search.data?.length ? (
                  <p className="text-sm text-muted-foreground">No matches found.</p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Trade ticket</CardTitle>
              <CardDescription>
                {selectedAsset.symbol} at{" "}
                {quote.data ? formatCurrency(quote.data.price) : "loading price"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {quote.error ? (
                <p className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">
                  {quote.error.message}
                </p>
              ) : null}
              <div className="rounded-md bg-muted p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{selectedAsset.symbol}</div>
                    <div className="text-sm text-muted-foreground">{selectedAsset.name}</div>
                  </div>
                  {quote.data ? (
                    <div
                      className={cn(
                        "text-right text-sm font-medium",
                        quote.data.change >= 0 ? "text-profit" : "text-loss",
                      )}
                    >
                      <div>{formatCurrency(quote.data.price)}</div>
                      <div>{formatPercent(quote.data.changePercent)}</div>
                    </div>
                  ) : null}
                </div>
              </div>
              <form className="space-y-3" onSubmit={(event) => onTrade(event, "buy")}>
                <div className="space-y-2">
                  <Label htmlFor="quantity">Quantity</Label>
                  <Input
                    id="quantity"
                    min="0.000001"
                    step="0.000001"
                    type="number"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button disabled={isTrading || !quote.data} type="submit">
                    Buy
                  </Button>
                  <Button
                    disabled={isTrading || !quote.data}
                    onClick={(event) => onTrade(event as unknown as FormEvent<HTMLFormElement>, "sell")}
                    type="button"
                    variant="outline"
                  >
                    Sell
                  </Button>
                </div>
              </form>
              <Button
                className="w-full"
                disabled={addToWatchlist.isPending}
                onClick={() => addToWatchlist.mutate(selectedAsset)}
                type="button"
                variant="secondary"
              >
                Add to watchlist
              </Button>
              {message ? (
                <p
                  className={cn(
                    "rounded-md border p-3 text-sm",
                    message.includes("not") || message.includes("enough")
                      ? "border-destructive/30 text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {message}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}

function MetricCard({
  icon,
  label,
  value,
  valueClassName,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className={cn("truncate text-xl font-semibold", valueClassName)}>
            {value}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
