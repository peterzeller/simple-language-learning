# Simple Language Learning

## Local development

This app expects Postgres connection settings in environment variables. For local development, the repository includes a Docker Compose setup and a matching env template for Next.js.

1. Copy the local env template:

```bash
cp .env.local.example .env.local
```

2. Start Postgres:

```bash
docker compose up -d postgres
```

3. Run the app:

```bash
npm run dev
```

Next.js automatically loads `.env.local`, so `npm run dev` will have the `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_DB`, and `POSTGRES_PASSWORD` values it needs to connect to the local Postgres container.

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Database startup behavior

On server startup, the app runs an idempotent database initialization step through Next.js instrumentation. Right now that setup ensures the `users` table exists before requests hit the login and registration flow.
