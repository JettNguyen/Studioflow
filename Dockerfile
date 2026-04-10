FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig.base.json ./
COPY .editorconfig ./
COPY apps ./apps
COPY packages ./packages

RUN npm ci

RUN npm run build --workspace @studioflow/shared && npm run build --workspace @studioflow/api

EXPOSE 4000

CMD ["sh", "-c", "for i in 1 2 3 4 5; do node_modules/.bin/prisma migrate deploy --schema=apps/api/prisma/schema.prisma && break; echo \"Prisma migrate deploy failed (attempt $i). Retrying...\"; sleep 3; done; node apps/api/dist/server.js"]
