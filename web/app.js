import { join } from "node:path";
import { readFileSync } from "node:fs";
import express from "express";
import compression from "compression";
import serveStatic from "serve-static";

import { shopify } from "./shopify.js";
import { GDPRWebhookHandlers } from "./gdpr.js";
import applyQrCodeApiEndpoints from "./middleware/qr-code-api.js";
import applyQrCodePublicEndpoints from "./middleware/qr-code-public.js";

const DEV_INDEX_PATH = join(process.cwd(), "frontend");
const PROD_INDEX_PATH = join(process.cwd(), "frontend", "dist");

export async function createApp({
  isProd = process.env.NODE_ENV === "production",
} = {}) {
  const app = express();

  app.get(shopify.config.auth.path, shopify.auth.begin());
  app.get(
    shopify.config.auth.callbackPath,
    shopify.auth.callback(),
    shopify.redirectToShopifyOrAppRoot()
  );

  // Do not call app.use(express.json()) before processing webhooks:
  // processWebhooks() needs the raw request body to validate the HMAC.
  app.post(
    shopify.config.webhooks.path,
    shopify.processWebhooks({ webhookHandlers: GDPRWebhookHandlers })
  );

  app.get("/health", (_req, res) => {
    res.status(200).send("");
  });

  applyQrCodePublicEndpoints(app);

  // All endpoints after this point will require an active session
  app.use("/api", shopify.validateAuthenticatedSession());

  // All endpoints after this point will have access to a request.body
  // attribute, as a result of the express.json() middleware
  app.use(express.json());

  applyQrCodeApiEndpoints(app);

  app.use(shopify.cspHeaders());

  if (isProd) {
    app.use(compression());
    app.use(serveStatic(PROD_INDEX_PATH, { index: false }));
  }

  app.use(shopify.ensureInstalledOnShop(), (_req, res) => {
    const htmlFile = join(
      isProd ? PROD_INDEX_PATH : DEV_INDEX_PATH,
      "index.html"
    );

    res
      .status(200)
      .set("Content-Type", "text/html")
      .send(readFileSync(htmlFile));
  });

  return { app };
}
