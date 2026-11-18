# syntax=docker/dockerfile:1

# 本番用 image です。web/ の依存をインストールし、フロントエンドをビルドしてバックエンドを起動します。
# SHOPIFY_API_KEY (公開される Client ID) はフロントエンドのビルドに必要なため build arg で渡します。
# SHOPIFY_API_SECRET などの秘密情報は image に含めず、実行時に環境変数で渡してください。

FROM node:26-alpine AS base
RUN npm install -g npm@12.2.3 && npm cache clean --force
WORKDIR /app

FROM base AS frontend
ARG SHOPIFY_API_KEY
WORKDIR /app/frontend
COPY web/frontend/package.json web/frontend/package-lock.json ./
RUN npm ci
COPY web/frontend/ ./
RUN SHOPIFY_API_KEY=$SHOPIFY_API_KEY npm run build

FROM base AS backend-deps
COPY web/package.json web/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=8081
RUN chown node:node /app
COPY --from=backend-deps /app/node_modules ./node_modules
COPY web/ ./
COPY --from=frontend /app/frontend/dist ./frontend/dist
USER node
EXPOSE 8081
CMD ["npm", "run", "serve"]
