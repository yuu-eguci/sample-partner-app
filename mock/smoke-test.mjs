/*
  Docker Compose で起動したアプリを、モック Shopify を相手に HTTP で確認するスモークテストです。
  compose.mock.yaml の smoke サービスとして、compose のネットワーク内で実行します。

  1. /health
  2. OAuth によるインストール (モックが自動で承認)
  3. 埋め込みアプリの HTML とフロントエンドの配信
  4. セッショントークン付きの API (商品数・割引・QR コードの作成/取得/一覧/更新/削除)
  5. QR コードの画像とスキャン時のリダイレクト
  6. APP_UNINSTALLED webhook によるセッション削除
*/
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const APP_URL = process.env.APP_URL;
const SHOP = process.env.MOCK_SHOP;
const API_KEY = process.env.MOCK_API_KEY;
const API_SECRET = process.env.MOCK_API_SECRET;
const HOST_PARAM = Buffer.from(`${SHOP}/admin`).toString("base64url");

let step = 0;
function log(message) {
  step += 1;
  console.info(`ok ${step} - ${message}`);
}

/*
  Cookie を保持しつつ、リダイレクトを追わずに 1 回だけリクエストします。
  Shopify のライブラリはボットと判定した User-Agent の OAuth を拒否するため、ブラウザの User-Agent を送ります。
*/
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const cookies = new Map();
async function send(url, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("User-Agent", USER_AGENT);
  if (cookies.size) {
    headers.set("Cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; "));
  }
  const response = await fetch(url, { ...init, headers, redirect: "manual" });
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(";");
    const index = pair.indexOf("=");
    cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }
  return response;
}

function sessionToken() {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    iss: `https://${SHOP}/admin`,
    dest: `https://${SHOP}`,
    aud: API_KEY,
    sub: "1",
    exp: now + 60,
    nbf: now - 60,
    iat: now - 60,
    jti: crypto.randomUUID(),
    sid: "smoke-test",
  });
  const signature = createHmac("sha256", API_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function api(path, init = {}) {
  return send(`${APP_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${sessionToken()}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

// 1. health
{
  const response = await send(`${APP_URL}/health`);
  assert.equal(response.status, 200);
  log("GET /health returns 200");
}

// 2. OAuth install
{
  const begin = await send(`${APP_URL}/api/auth?shop=${SHOP}`);
  assert.equal(begin.status, 302);
  const authorizeUrl = new URL(begin.headers.get("location"));
  assert.equal(authorizeUrl.origin, `https://${SHOP}`);
  log("GET /api/auth redirects to the mock OAuth authorize page");

  const approve = await send(authorizeUrl);
  assert.equal(approve.status, 302);
  const callbackUrl = new URL(approve.headers.get("location"));
  assert.equal(callbackUrl.origin, APP_URL);
  log("mock Shopify approves the installation");

  const callback = await send(callbackUrl);
  assert.equal(callback.status, 302, await callback.clone().text());
  assert.equal(
    callback.headers.get("location"),
    `https://${SHOP}/admin/apps/${API_KEY}`
  );
  log("OAuth callback stores the session and redirects into the Shopify admin");
}

// 3. embedded app HTML and frontend assets
{
  const response = await send(
    `${APP_URL}/?shop=${SHOP}&host=${HOST_PARAM}&embedded=1`
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(
    response.headers.get("content-security-policy"),
    new RegExp(`frame-ancestors https://${SHOP.replaceAll(".", "\\.")}`)
  );
  const script = html.match(/<script type="module" crossorigin src="([^"]+)"/);
  assert.ok(script, "built index.html references the frontend bundle");
  const asset = await send(`${APP_URL}${script[1]}`);
  assert.equal(asset.status, 200);
  const bundle = await asset.text();
  assert.ok(bundle.includes(API_KEY), "bundle is built with the API key");
  log("embedded app HTML and built frontend bundle are served");
}

// 4. authenticated API
let qrCode;
{
  const count = await api("/api/products/count");
  assert.equal(count.status, 200);
  assert.deepEqual(await count.json(), { count: 2 });
  log("GET /api/products/count returns the mock product count");

  const discounts = await api("/api/discounts");
  assert.equal(discounts.status, 200);
  const discountData = await discounts.json();
  assert.equal(
    discountData.codeDiscountNodes.edges[0].node.codeDiscount.codes.edges[0].node.code,
    "MOCK10"
  );
  log("GET /api/discounts returns the mock discount codes");

  const created = await api("/api/qrcodes", {
    method: "POST",
    body: JSON.stringify({
      title: "Smoke test QR code",
      productId: "gid://shopify/Product/1001",
      variantId: "gid://shopify/ProductVariant/2001",
      handle: "mock-t-shirt",
      discountId: "gid://shopify/DiscountCodeNode/3001",
      discountCode: "MOCK10",
      destination: "product",
    }),
  });
  assert.equal(created.status, 201);
  qrCode = await created.json();
  assert.equal(qrCode.product.title, "Mock T-shirt");
  log(`POST /api/qrcodes creates QR code ${qrCode.id}`);

  const list = await api("/api/qrcodes");
  assert.equal(list.status, 200);
  assert.ok((await list.json()).some(({ id }) => id === qrCode.id));
  log("GET /api/qrcodes lists the QR code");

  const updated = await api(`/api/qrcodes/${qrCode.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: "Smoke test QR code (checkout)",
      productId: "gid://shopify/Product/1001",
      variantId: "gid://shopify/ProductVariant/2001",
      handle: "mock-t-shirt",
      discountId: "gid://shopify/DiscountCodeNode/3001",
      discountCode: "MOCK10",
      destination: "checkout",
    }),
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).destination, "checkout");
  log("PATCH /api/qrcodes/:id updates the QR code");
}

// 5. public QR code endpoints
{
  const image = await send(`${APP_URL}/qrcodes/${qrCode.id}/image`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  log("GET /qrcodes/:id/image returns a PNG");

  const scan = await send(`${APP_URL}/qrcodes/${qrCode.id}/scan`);
  assert.equal(scan.status, 302);
  const destination = scan.headers.get("location");
  assert.equal(destination, `https://${SHOP}/cart/2001:1?discount=MOCK10`);
  const storefront = await send(destination);
  assert.equal(storefront.status, 200);
  log("GET /qrcodes/:id/scan redirects to the mock storefront checkout");

  const read = await api(`/api/qrcodes/${qrCode.id}`);
  assert.equal((await read.json()).scans, 1);
  log("the scan is counted");

  const deleted = await api(`/api/qrcodes/${qrCode.id}`, { method: "DELETE" });
  assert.equal(deleted.status, 200);
  const missing = await api(`/api/qrcodes/${qrCode.id}`);
  assert.equal(missing.status, 404);
  log("DELETE /api/qrcodes/:id deletes the QR code");
}

// 6. uninstall webhook
{
  const body = JSON.stringify({ id: 1, domain: SHOP });
  const response = await send(`${APP_URL}/api/webhooks`, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Topic": "app/uninstalled",
      "X-Shopify-Shop-Domain": SHOP,
      "X-Shopify-API-Version": "2026-10",
      "X-Shopify-Webhook-Id": crypto.randomUUID(),
      "X-Shopify-Hmac-Sha256": createHmac("sha256", API_SECRET)
        .update(body)
        .digest("base64"),
    },
  });
  assert.equal(response.status, 200);
  const afterUninstall = await api("/api/qrcodes");
  assert.equal(afterUninstall.status, 403);
  assert.equal(
    afterUninstall.headers.get("x-shopify-api-request-failure-reauthorize"),
    "1"
  );
  log("APP_UNINSTALLED webhook removes the installation");
}

console.info("Smoke test passed");
