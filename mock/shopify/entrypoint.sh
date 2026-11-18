#!/bin/sh
# 起動のたびに、モック Shopify (MOCK_SHOP) とアプリの HTTPS 入口 (MOCK_APP_HOST) 用の
# 自己署名証明書を生成し、共有ボリューム (/certs) に置きます。
# アプリとテスト用コンテナは NODE_EXTRA_CA_CERTS=/certs/mock-shopify.pem でこの証明書を信頼します。
set -eu
mkdir -p /certs
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj "/CN=${MOCK_SHOP}" \
  -addext "subjectAltName=DNS:${MOCK_SHOP},DNS:${MOCK_APP_HOST}" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -keyout /tmp/mock-shopify-key.pem -out /certs/mock-shopify.pem 2>/dev/null
exec node /mock/server.mjs
