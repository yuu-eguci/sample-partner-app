import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { shopify } from "../shopify.js";
import {
  SHOP,
  installShop,
  mockAdminGraphql,
  sessionToken,
  webhookHmac,
} from "./helpers.js";

const PRODUCT_ID = "gid://shopify/Product/1";
const VARIANT_ID = "gid://shopify/ProductVariant/11";
const DISCOUNT_ID = "gid://shopify/DiscountCodeNode/21";

/* Admin GraphQL API のモック応答です。 */
function adminApi(query) {
  if (query.includes("shopifyAppShopName")) {
    return { shop: { name: "Test shop" } };
  }
  if (query.includes("productsCount")) {
    return { productsCount: { count: 3 } };
  }
  if (query.includes("codeDiscountNodes")) {
    return {
      codeDiscountNodes: {
        edges: [
          {
            node: {
              id: DISCOUNT_ID,
              codeDiscount: { codes: { edges: [{ node: { code: "SALE10" } }] } },
            },
          },
        ],
      },
    };
  }
  if (query.includes("nodes(ids: $ids)")) {
    return {
      nodes: [
        { id: PRODUCT_ID, handle: "shirt", title: "Shirt", images: { edges: [] } },
        { id: VARIANT_ID },
        { id: DISCOUNT_ID },
      ],
    };
  }
  throw new Error(`Unexpected query: ${query}`);
}

const qrCodeBody = {
  title: "Spring campaign",
  productId: PRODUCT_ID,
  variantId: VARIANT_ID,
  handle: "shirt",
  discountId: DISCOUNT_ID,
  discountCode: "SALE10",
  destination: "product",
};

let app;
beforeAll(async () => {
  ({ app } = await createApp({ isProd: false }));
});

function authorized(req) {
  return req.set("Authorization", `Bearer ${sessionToken()}`);
}

describe("GET /health", () => {
  it("returns 200 without authentication", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
  });
});

describe("authentication", () => {
  it("starts OAuth with the shop's authorize URL", async () => {
    const response = await request(app).get(`/api/auth?shop=${SHOP}`);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.location);
    expect(location.origin).toBe(`https://${SHOP}`);
    expect(location.pathname).toBe("/admin/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("test-api-key");
  });

  it("rejects API requests with an invalid session token", async () => {
    const response = await request(app)
      .get("/api/qrcodes")
      .set("Authorization", "Bearer invalid.token.value");
    expect(response.status).toBe(401);
  });

  it("asks App Bridge to reauthorize when the shop is not installed", async () => {
    const response = await request(app)
      .get("/api/qrcodes")
      .set("Authorization", `Bearer ${sessionToken("not-installed.myshopify.com")}`);
    expect(response.status).toBe(403);
    expect(response.headers["x-shopify-api-request-failure-reauthorize"]).toBe("1");
    expect(
      response.headers["x-shopify-api-request-failure-reauthorize-url"]
    ).toBe("/api/auth?shop=not-installed.myshopify.com");
  });
});

describe("embedded app HTML", () => {
  it("requires the shop query", async () => {
    const response = await request(app).get("/");
    expect(response.status).toBe(400);
  });

  it("redirects shops without an installation to OAuth", async () => {
    const response = await request(app).get(
      "/?shop=not-installed.myshopify.com"
    );
    expect(response.status).toBe(302);
    expect(response.headers.location).toMatch(
      /^https:\/\/not-installed\.myshopify\.com\/admin\/oauth\/authorize/
    );
  });

  it("serves index.html with a frame-ancestors CSP for installed shops", async () => {
    await installShop(shopify);
    const response = await request(app).get(
      `/qrcodes/new?shop=${SHOP}&host=dGVzdA&embedded=1`
    );
    expect(response.status).toBe(200);
    expect(response.text).toContain("test index");
    expect(response.headers["content-security-policy"]).toContain(
      `frame-ancestors https://${SHOP} https://admin.shopify.com`
    );
  });
});

describe("authenticated API", () => {
  beforeAll(async () => {
    await installShop(shopify);
  });

  it("returns the product count", async () => {
    mockAdminGraphql(adminApi);
    const response = await authorized(request(app).get("/api/products/count"));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ count: 3 });
  });

  it("returns discount codes", async () => {
    mockAdminGraphql(adminApi);
    const response = await authorized(request(app).get("/api/discounts"));
    expect(response.status).toBe(200);
    expect(response.body.codeDiscountNodes.edges[0].node.id).toBe(DISCOUNT_ID);
  });

  it("creates, reads, updates, lists and deletes QR codes", async () => {
    const requests = mockAdminGraphql(adminApi);

    const created = await authorized(
      request(app).post("/api/qrcodes").send(qrCodeBody)
    );
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      title: "Spring campaign",
      shopDomain: `https://${SHOP}`,
      discountCode: "SALE10",
      destination: "product",
      scans: 0,
      product: { id: PRODUCT_ID, title: "Shirt", handle: "shirt" },
      imageUrl: `https://app.example.test/qrcodes/${created.body.id}/image`,
    });
    expect(created.body).not.toHaveProperty("productId");
    expect(requests.at(-1).body.variables.ids).toEqual([
      PRODUCT_ID,
      VARIANT_ID,
      DISCOUNT_ID,
    ]);

    const id = created.body.id;

    const read = await authorized(request(app).get(`/api/qrcodes/${id}`));
    expect(read.status).toBe(200);
    expect(read.body.title).toBe("Spring campaign");

    const updated = await authorized(
      request(app)
        .patch(`/api/qrcodes/${id}`)
        .send({ ...qrCodeBody, title: "Summer campaign", destination: "checkout" })
    );
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      title: "Summer campaign",
      destination: "checkout",
    });

    const list = await authorized(request(app).get("/api/qrcodes"));
    expect(list.status).toBe(200);
    expect(list.body.map((qrCode) => qrCode.id)).toContain(id);

    const deleted = await authorized(request(app).delete(`/api/qrcodes/${id}`));
    expect(deleted.status).toBe(200);

    const missing = await authorized(request(app).get(`/api/qrcodes/${id}`));
    expect(missing.status).toBe(404);
  });

  it("clears the discount when the discount was deleted in Shopify", async () => {
    mockAdminGraphql(adminApi);
    const created = await authorized(
      request(app).post("/api/qrcodes").send(qrCodeBody)
    );

    mockAdminGraphql((query, variables) =>
      query.includes("nodes(ids: $ids)")
        ? { nodes: [{ id: PRODUCT_ID, title: "Shirt", handle: "shirt" }, { id: VARIANT_ID }, null] }
        : adminApi(query, variables)
    );
    const read = await authorized(
      request(app).get(`/api/qrcodes/${created.body.id}`)
    );
    expect(read.body.discountCode).toBe("");
  });

  it("does not expose QR codes of other shops", async () => {
    mockAdminGraphql(adminApi);
    const created = await authorized(
      request(app).post("/api/qrcodes").send(qrCodeBody)
    );

    await installShop(shopify, "other-shop.myshopify.com");
    const response = await request(app)
      .get(`/api/qrcodes/${created.body.id}`)
      .set(
        "Authorization",
        `Bearer ${sessionToken("other-shop.myshopify.com")}`
      );
    expect(response.status).toBe(404);
  });
});

describe("public QR code endpoints", () => {
  let id;
  beforeAll(async () => {
    await installShop(shopify);
    mockAdminGraphql(adminApi);
    const created = await authorized(
      request(app).post("/api/qrcodes").send(qrCodeBody)
    );
    id = created.body.id;
  });

  it("returns the QR code image as PNG", async () => {
    const response = await request(app).get(`/qrcodes/${id}/image`);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.body.subarray(1, 4).toString()).toBe("PNG");
  });

  it("redirects scans to the product page with the discount and counts them", async () => {
    const response = await request(app).get(`/qrcodes/${id}/scan`);
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(
      `https://${SHOP}/discount/SALE10?redirect=%2Fproducts%2Fshirt`
    );

    mockAdminGraphql(adminApi);
    const read = await authorized(request(app).get(`/api/qrcodes/${id}`));
    expect(read.body.scans).toBe(1);
  });

  it("redirects checkout scans to the cart", async () => {
    mockAdminGraphql(adminApi);
    await authorized(
      request(app)
        .patch(`/api/qrcodes/${id}`)
        .send({ ...qrCodeBody, destination: "checkout" })
    );
    const response = await request(app).get(`/qrcodes/${id}/scan`);
    expect(response.headers.location).toBe(
      `https://${SHOP}/cart/11:1?discount=SALE10`
    );
  });

  it("returns 404 for unknown QR codes", async () => {
    const response = await request(app).get("/qrcodes/999999/image");
    expect(response.status).toBe(404);
  });
});

describe("POST /api/webhooks", () => {
  function sendWebhook(topic, body, hmac = webhookHmac(body)) {
    return request(app)
      .post("/api/webhooks")
      .set("Content-Type", "application/json")
      .set("X-Shopify-Topic", topic)
      .set("X-Shopify-Shop-Domain", SHOP)
      .set("X-Shopify-Hmac-Sha256", hmac)
      .set("X-Shopify-Webhook-Id", "test-webhook-id")
      .set("X-Shopify-API-Version", shopify.api.config.apiVersion)
      .send(body);
  }

  it("rejects webhooks with an invalid HMAC", async () => {
    const response = await sendWebhook("app/uninstalled", "{}", "invalid");
    expect(response.status).toBe(401);
  });

  it("accepts the mandatory privacy webhooks", async () => {
    const body = JSON.stringify({ shop_id: 1, shop_domain: SHOP });
    const response = await sendWebhook("shop/redact", body);
    expect(response.status).toBe(200);
  });

  it("deletes the shop sessions when the app is uninstalled", async () => {
    await installShop(shopify);
    const response = await sendWebhook("app/uninstalled", "{}");
    expect(response.status).toBe(200);
    const sessions =
      await shopify.config.sessionStorage.findSessionsByShop(SHOP);
    expect(sessions).toEqual([]);
  });
});
