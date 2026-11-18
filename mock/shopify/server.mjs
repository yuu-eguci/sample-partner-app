/*
  動作確認用のモック Shopify です。実際の Shopify には一切接続しません。
  compose のネットワーク内で MOCK_SHOP (例: mock-shop.myshopify.com) として HTTPS で応答し、
  次の機能だけを提供します。

  - OAuth: /admin/oauth/authorize (自動で承認) と /admin/oauth/access_token
  - Admin GraphQL API: アプリが使うクエリ・mutation に固定データで応答
  - 管理画面: アプリを iframe で埋め込み、App Bridge (v3) のメッセージに応答するホストページ
    (/admin/apps/<API キー>/<アプリ内のパス>)
  - ストアフロント: QR コードのスキャン先 (/products/*, /discount/*, /cart/*) の簡易ページ

  また、https://MOCK_APP_HOST:8443 でアプリ (MOCK_APP_UPSTREAM) への HTTPS リバースプロキシとして動きます。
  実際の Shopify と同じく、https の管理画面から https のアプリを埋め込むためです。
*/
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer } from "node:https";

const SHOP = process.env.MOCK_SHOP;
const API_KEY = process.env.MOCK_API_KEY;
const API_SECRET = process.env.MOCK_API_SECRET;
const SCOPES = process.env.MOCK_SCOPES;
const APP_URL = `https://${process.env.MOCK_APP_HOST}:8443`;
const APP_UPSTREAM = process.env.MOCK_APP_UPSTREAM;
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

/* App Bridge のセッショントークン (HS256 の JWT) を発行します。 */
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
    nbf: now - 5,
    iat: now - 5,
    jti: crypto.randomUUID(),
    sid: "mock-admin",
  });
  const signature = createHmac("sha256", API_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/*
  Shopify 管理画面の代わりに、アプリを iframe で埋め込むページです。
  App Bridge (v3) が postMessage で送るアクションのうち、アプリの動作に必要なものに応答し、
  タイトル・保存バー・トースト・リダイレクトを画面に表示します。
*/
function adminHostPage(url, res) {
  const appPath = url.pathname.replace(/^\/admin\/apps\/[^/]+/, "") || "/";
  const appUrl = new URL(appPath, APP_URL);
  for (const [key, value] of url.searchParams) appUrl.searchParams.set(key, value);
  appUrl.searchParams.set("shop", SHOP);
  appUrl.searchParams.set("host", Buffer.from(`${SHOP}/admin`).toString("base64url"));
  appUrl.searchParams.set("embedded", "1");

  const selection = PRODUCTS.map((product) => ({ ...product, images: [] }));
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Mock Shopify admin</title>
  <style>
    body { margin: 0; font-family: sans-serif; }
    header { display: flex; gap: 1rem; align-items: center; padding: 0.5rem 1rem; background: #1a1a1a; color: #fff; }
    #save-bar[hidden] { display: none; }
    iframe { width: 100%; height: calc(100vh - 3rem); border: 0; }
  </style>
</head>
<body>
  <header>
    <strong id="title-bar"></strong>
    <span id="save-bar" hidden>
      <button id="save-bar-discard" type="button">Discard</button>
      <button id="save-bar-save" type="button">Save</button>
    </span>
    <span id="toast" role="status"></span>
    <span id="redirect"></span>
  </header>
  <iframe id="app-frame" title="app" src="${appUrl}"></iframe>
  <script>
    const APP_ORIGIN = ${JSON.stringify(new URL(APP_URL).origin)};
    const SELECTION = ${JSON.stringify(selection)};
    const frame = document.getElementById("app-frame");
    const saveBar = document.getElementById("save-bar");
    let saveBarId = null;
    window.mockAdmin = { actions: [] };

    function respond(action) {
      frame.contentWindow.postMessage({ type: "dispatch", payload: action }, APP_ORIGIN);
    }
    function saveBarAction(type) {
      respond({ type, group: "ContextualSaveBar", payload: { id: saveBarId } });
    }
    document.getElementById("save-bar-save").addEventListener("click", () =>
      saveBarAction("APP::CONTEXTUAL_SAVE_BAR::SAVE"));
    document.getElementById("save-bar-discard").addEventListener("click", () =>
      saveBarAction("APP::CONTEXTUAL_SAVE_BAR::DISCARD"));

    window.addEventListener("message", async (event) => {
      if (event.origin !== APP_ORIGIN || event.data?.type !== "dispatch") return;
      const action = event.data.payload;
      window.mockAdmin.actions.push(action.type);
      switch (action.type) {
        case "APP::SESSION_TOKEN::REQUEST": {
          const response = await fetch("/admin/mock/session-token");
          const { sessionToken } = await response.json();
          respond({ type: "APP::SESSION_TOKEN::RESPOND", group: "SessionToken", payload: { sessionToken } });
          break;
        }
        case "APP::NAVIGATION::REDIRECT::APP":
          // 管理画面と同じく、アプリ内の遷移をアプリへ通知します。
          respond(action);
          break;
        case "APP::NAVIGATION::REDIRECT::REMOTE":
        case "APP::NAVIGATION::REDIRECT::ADMIN::SECTION":
        case "APP::NAVIGATION::REDIRECT::ADMIN::PATH":
          document.getElementById("redirect").textContent =
            "Redirect: " + JSON.stringify(action.payload);
          break;
        case "APP::RESOURCE_PICKER::OPEN":
          respond({
            type: "APP::RESOURCE_PICKER::SELECT",
            group: "Resource_Picker",
            payload: { id: action.payload.id, selection: SELECTION.slice(0, 1) },
          });
          break;
        case "APP::CONTEXTUAL_SAVE_BAR::SHOW":
          saveBarId = action.payload.id;
          saveBar.hidden = false;
          break;
        case "APP::CONTEXTUAL_SAVE_BAR::HIDE":
          saveBar.hidden = true;
          break;
        case "APP::TITLEBAR::UPDATE":
          document.getElementById("title-bar").textContent = action.payload.title ?? "";
          break;
        case "APP::TOAST::SHOW":
          document.getElementById("toast").textContent = action.payload.message;
          break;
      }
    });
  </script>
</body>
</html>`);
}

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

const tls = {
  key: readFileSync("/tmp/mock-shopify-key.pem"),
  cert: readFileSync("/certs/mock-shopify.pem"),
};

const server = createServer(
  tls,
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
      if (req.method === "GET" && url.pathname === "/admin/mock/session-token") {
        return sendJson(res, 200, { sessionToken: sessionToken() });
      }
      if (req.method === "GET" && url.pathname.startsWith(`/admin/apps/${API_KEY}`)) {
        return adminHostPage(url, res);
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

/* アプリへの HTTPS リバースプロキシ (TLS 終端) です。 */
const appProxy = createServer(tls, (req, res) => {
  const upstream = new URL(req.url, APP_UPSTREAM);
  const proxyReq = httpRequest(
    upstream,
    { method: req.method, headers: { ...req.headers, "x-forwarded-proto": "https" } },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on("error", (error) => {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end(`Mock proxy error: ${error.message}`);
  });
  req.pipe(proxyReq);
});

appProxy.listen(8443, () => {
  console.info(`Proxying ${APP_URL} to ${APP_UPSTREAM}`);
});
