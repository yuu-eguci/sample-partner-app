/*
  動作確認用のモック Shopify です。実際の Shopify には一切接続しません。
  compose のネットワーク内で MOCK_SHOP (例: mock-shop.myshopify.com) として HTTPS で応答し、
  次の機能だけを提供します。

  - OAuth: /admin/oauth/authorize (自動で承認) と /admin/oauth/access_token
  - Admin GraphQL API: アプリが使うクエリ・mutation に固定データで応答
  - ストアフロント: QR コードのスキャン先 (/products/*, /discount/*, /cart/*) の簡易ページ
*/
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";

const SHOP = process.env.MOCK_SHOP;
const API_KEY = process.env.MOCK_API_KEY;
const API_SECRET = process.env.MOCK_API_SECRET;
const SCOPES = process.env.MOCK_SCOPES;
const ACCESS_TOKEN = "mock-access-token";
const AUTH_CODE = "mock-auth-code";

const PRODUCTS = [
  {
    id: "gid://shopify/Product/1001",
    title: "Mock T-shirt",
    handle: "mock-t-shirt",
    variants: [{ id: "gid://shopify/ProductVariant/2001" }],
  },
  {
    id: "gid://shopify/Product/1002",
    title: "Mock Hoodie",
    handle: "mock-hoodie",
    variants: [{ id: "gid://shopify/ProductVariant/2002" }],
  },
];
const DISCOUNTS = [
  { id: "gid://shopify/DiscountCodeNode/3001", code: "MOCK10" },
];

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendHtml(res, title) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!DOCTYPE html><html><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/* OAuth コールバックのクエリに付ける HMAC (Shopify と同じ計算方法) です。 */
function oauthHmac(params) {
  const message = [...params.entries()]
    .filter(([key]) => key !== "hmac")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHmac("sha256", API_SECRET).update(message).digest("hex");
}

function authorize(url, res) {
  if (url.searchParams.get("client_id") !== API_KEY) {
    return sendJson(res, 400, { error: "invalid client_id" });
  }
  const redirectUri = new URL(url.searchParams.get("redirect_uri"));
  const params = new URLSearchParams({
    code: AUTH_CODE,
    host: Buffer.from(`${SHOP}/admin`).toString("base64url"),
    shop: SHOP,
    state: url.searchParams.get("state"),
    timestamp: String(Math.floor(Date.now() / 1000)),
  });
  params.set("hmac", oauthHmac(params));
  redirectUri.search = params.toString();
  res.writeHead(302, { Location: redirectUri.toString() });
  res.end();
}

async function accessToken(req, res) {
  const body = JSON.parse(await readBody(req));
  if (
    body.client_id !== API_KEY ||
    body.client_secret !== API_SECRET ||
    body.code !== AUTH_CODE
  ) {
    return sendJson(res, 400, { error: "invalid_request" });
  }
  sendJson(res, 200, { access_token: ACCESS_TOKEN, scope: SCOPES });
}

function resolveGraphql(query, variables) {
  if (query.includes("shopifyAppShopName")) {
    return { shop: { name: "Mock shop" } };
  }
  if (query.includes("productsCount")) {
    return { productsCount: { count: PRODUCTS.length } };
  }
  if (query.includes("codeDiscountNodes")) {
    return {
      codeDiscountNodes: {
        edges: DISCOUNTS.map(({ id, code }) => ({
          node: { id, codeDiscount: { codes: { edges: [{ node: { code } }] } } },
        })),
      },
    };
  }
  if (query.includes("nodes(ids: $ids)")) {
    return {
      nodes: variables.ids.map((id) => {
        const product = PRODUCTS.find((p) => p.id === id);
        if (product) {
          return { id, title: product.title, handle: product.handle, images: { edges: [] } };
        }
        const known =
          PRODUCTS.some((p) => p.variants.some((v) => v.id === id)) ||
          DISCOUNTS.some((d) => d.id === id);
        return known ? { id } : null;
      }),
    };
  }
  if (query.includes("webhookSubscriptions(")) {
    return {
      webhookSubscriptions: {
        edges: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
  }
  if (query.includes("webhookSubscriptionCreate")) {
    return {
      webhookSubscriptionCreate: {
        webhookSubscription: { id: "gid://shopify/WebhookSubscription/4001" },
        userErrors: [],
      },
    };
  }
  return undefined;
}

async function graphql(req, res) {
  if (req.headers["x-shopify-access-token"] !== ACCESS_TOKEN) {
    return sendJson(res, 401, { errors: "[API] Invalid API key or access token" });
  }
  const { query, variables = {} } = JSON.parse(await readBody(req));
  const data = resolveGraphql(query, variables);
  if (!data) {
    console.error(`Unsupported GraphQL query: ${query}`);
    return sendJson(res, 200, { errors: [{ message: "Unsupported query in mock" }] });
  }
  sendJson(res, 200, { data });
}

const server = createServer(
  {
    key: readFileSync("/tmp/mock-shopify-key.pem"),
    cert: readFileSync("/certs/mock-shopify.pem"),
  },
  async (req, res) => {
    const url = new URL(req.url, `https://${SHOP}`);
    console.info(`${req.method} ${url.pathname}`);
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/admin/oauth/authorize") {
        return authorize(url, res);
      }
      if (req.method === "POST" && url.pathname === "/admin/oauth/access_token") {
        return await accessToken(req, res);
      }
      if (req.method === "POST" && /^\/admin\/api\/[^/]+\/graphql\.json$/.test(url.pathname)) {
        return await graphql(req, res);
      }
      if (req.method === "GET" && /^\/(products|discount|cart)\//.test(url.pathname)) {
        return sendHtml(res, `Mock storefront: ${url.pathname}${url.search}`);
      }
      sendJson(res, 404, { error: "Not found in mock" });
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { error: String(error) });
    }
  }
);

server.listen(443, () => {
  console.info(`Mock Shopify is listening as https://${SHOP}`);
});
