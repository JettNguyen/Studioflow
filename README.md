# Studioflow

Studioflow is a music collaboration web app for producers, vocalists, and collaborators.

## Workspace

- `apps/web`: React + Vite client
- `apps/api`: Express API
- `packages/shared`: shared types and contracts
- `infra`: local development infrastructure config

## Quick Start

1. Install dependencies:
   - `npm install`
2. Start local infrastructure (optional first run):
   - `docker compose -f infra/docker-compose.yml up -d`
3. Run API and web app:
   - `npm run dev`

## Environment

Use a single root environment file.

1. Copy `.env.example` to `.env` in the project root.
2. Set values in root `.env` for both API and web.
3. Do not create app-specific env files in `apps/api` or `apps/web`.

## AWS S3 Setup Check

1. Ensure root `.env` has `S3_REGION`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` set.
2. Confirm bucket CORS allows your frontend origin if you download directly from browser contexts.
3. Confirm the IAM credentials have at least: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, and `s3:ListBucket` for your bucket.
4. Run storage validation:
   - `npm run storage:check --workspace @studioflow/api`
5. A successful check prints bucket, region, and endpoint confirmation.
