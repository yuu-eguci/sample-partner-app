# モック環境でブラウザ (Chromium) から画面と主要な操作を確認する e2e テストです。
FROM mcr.microsoft.com/playwright:v1.65.1-noble
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /e2e
COPY package.json package-lock.json ./
RUN npm ci
COPY e2e.mjs ./
CMD ["node", "e2e.mjs"]
