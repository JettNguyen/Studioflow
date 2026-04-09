FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY apps ./apps
COPY packages ./packages

RUN npm ci

RUN npm run build

EXPOSE 4000

CMD ["node", "apps/api/dist/server.js"]
