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

Copy each `.env.example` file to `.env` before running.
