# Izaija

Izaija is a mock investing web app. Users sign in, choose a virtual starting balance, search stocks and crypto, place simulated buy/sell orders, and track how their portfolio performs over time.

## Stack

- Next.js App Router
- TypeScript and React
- Tailwind CSS
- Shadcn-style UI components
- Clerk authentication
- tRPC API endpoints
- Prisma with Prisma Postgres
- Alpaca stock market data
- Binance public crypto market data
- Prisma-backed quote and chart caching

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

   On this Windows host, use `npm.cmd` instead of `npm` if PowerShell blocks `npm.ps1`.

2. Copy `.env.example` to `.env` and fill in your secrets:

   ```bash
   cp .env.example .env
   ```

3. Create a Clerk application and configure sign-in:

   - Enable email address + password.
   - Disable social providers, passkeys, magic links, and other sign-in methods if you want email/password only.
   - Put the publishable key into `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.
   - Put the secret key into `CLERK_SECRET_KEY`.

4. Market data:

   - Create an Alpaca account at `https://alpaca.markets/`.
   - Open the Alpaca dashboard.
   - Choose paper trading.
   - Open API keys and generate or regenerate a key pair.
   - Put the key id into `ALPACA_API_KEY_ID`.
   - Put the secret key into `ALPACA_API_SECRET_KEY`.
   - Crypto prices use Binance public market endpoints and do not require a key.
   - Quotes are cached in Prisma for 1 minute. Chart series are cached in Prisma for 5 minutes.

   Without Alpaca keys, stock search/quotes will be unavailable. Crypto search/quotes still work through Binance.

   Optional Binance API keys are not needed for this app because public market data endpoints are enough. If you still want one, create a Binance account, open API Management, and create an API key with trading disabled. Do not add withdrawal permissions.

5. Apply database migrations:

   ```bash
   npm run db:migrate
   ```

   For deployment on Prisma Compute, use the project's primary database and run:

   ```bash
   npx prisma migrate deploy
   ```

6. Start the dev server:

   ```bash
   npm run dev
   ```

Open `http://localhost:3000`.

## Notes

- `.env` is ignored by Git and should not be committed.
- `DATABASE_URL` is ignored by Git and should only live in `.env` or the Prisma project environment.
- This is a virtual-money simulator. No real orders are placed.
