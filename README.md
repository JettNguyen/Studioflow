# [Studioflow](https://studioflow-music.vercel.app)

<p align="center">
  <a href="https://studioflow-music.vercel.app"><img src="apps/web/public/icon-512.svg" alt="Studioflow logo" width="128" /></a>
</p>

Studioflow is a simple, fast, and collaborative web app for music creators, including producers, vocalists, and collaborators, to work together on songs, share ideas, and manage project assets.

## Why Studioflow?

- **Collaborate**: Share project files and invite collaborators.
- **Streamlined**: Lightweight web client and a small Express API.
- **Portable**: Sync your own Google Drive assets with cloud storage.

### Tech stack

- React + Vite
- Express
- Prisma
- AWS S3 / compatible object storage
- Google Drive integration

### Workspace layout

- `apps/web`: React + Vite client
- `apps/api`: Express API
- `packages/shared`: shared types and contracts
- `infra`: local development infrastructure config

### Developer Quick Start

1. Install dependencies:
   - `npm install`
2. Start local infrastructure (optional first run):
   - `docker compose -f infra/docker-compose.yml up -d`
3. Run API and web app:
   - `npm run dev`

### Environment

Use a single root environment file.

1. Copy `.env.example` to `.env` in the project root.
2. Set values in root `.env` for both API and web.
3. Do not create app-specific env files in `apps/api` or `apps/web`.

### AWS S3 Setup Check

1. Ensure root `.env` has `S3_REGION`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` set.
2. Confirm bucket CORS allows your frontend origin if you download directly from browser contexts.
3. Confirm the IAM credentials have at least: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, and `s3:ListBucket` for your bucket.
4. Run storage validation:
   - `npm run storage:check --workspace @studioflow/api`
5. A successful check prints bucket, region, and endpoint confirmation.

### Getting help

- **Local debugging:** see `apps/api/src` and `web/src` for app entry points.
- **Run storage check:** `npm run storage:check --workspace @studioflow/api`

---
Made by [Jett2Fly](https://jett2fly.com)
