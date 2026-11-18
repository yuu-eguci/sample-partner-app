import { createHmac } from "node:crypto";
import { Session } from "@shopify/shopify-api";

export const SHOP = "test-shop.myshopify.com";
export const ACCESS_TOKEN = "test-access-token";

/* テスト用のオフラインセッションを保存します (インストール済みの状態にします)。 */
export async function installShop(shopify, shop = SHOP) {
  const session = new Session({
    id: shopify.api.session.getOfflineId(shop),
    shop,
    state: "test-state",
    isOnline: false,
    scope: process.env.SCOPES,
    accessToken: ACCESS_TOKEN,
  });
  await shopify.config.sessionStorage.storeSession(session);
  return session;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

/* App Bridge が発行するものと同じ形式のセッショントークン (HS256 の JWT) を作ります。 */
export function sessionToken(shop = SHOP) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: `https://${shop}/admin`,
      dest: `https://${shop}`,
      aud: process.env.SHOPIFY_API_KEY,
      sub: "1",
      exp: now + 60,
      nbf: now - 60,
      iat: now - 60,
      jti: "test-jti",
      sid: "test-sid",
    })
  );
  const signature = createHmac("sha256", process.env.SHOPIFY_API_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/* Admin GraphQL API への fetch を、クエリに応じた固定の応答で置き換えます。 */
export function mockAdminGraphql(resolve) {
  const requests = [];
  globalThis.__shopifyFetchHandler = async (input, init) => {
    const url = String(input);
    if (!/\/admin\/api\/[^/]+\/graphql\.json$/.test(url)) {
      throw new Error(`Unexpected fetch in test: ${url}`);
    }
    const body = JSON.parse(init.body);
    requests.push({ url, body });
    const data = resolve(body.query, body.variables ?? {});
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return requests;
}

export function webhookHmac(body) {
  return createHmac("sha256", process.env.SHOPIFY_API_SECRET)
    .update(body, "utf8")
    .digest("base64");
}
