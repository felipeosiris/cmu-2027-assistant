# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8788
ENV VAULT_CWD=/app/vault

EXPOSE 8788
CMD ["npm", "run", "start"]
