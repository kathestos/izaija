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
- Twelve Data market data integration with a local demo fallback

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

4. Optional market data:

   - Create a free Twelve Data account at `https://twelvedata.com/`.
   - Copy your API key into `TWELVE_DATA_API_KEY`.
   - If no key is set, the app still runs with deterministic demo prices for development.

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
