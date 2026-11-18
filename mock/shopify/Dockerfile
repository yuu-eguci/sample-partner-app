# 動作確認用のモック Shopify です。本番 image には含めません。
FROM node:26-alpine
RUN apk add --no-cache openssl
WORKDIR /mock
COPY entrypoint.sh server.mjs ./
EXPOSE 443 8443
ENTRYPOINT ["sh", "/mock/entrypoint.sh"]
