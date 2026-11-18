/*
  The custom REST API to support the app frontend.
  Handlers combine application data from qr-codes-db.js with helpers to merge the Shopify GraphQL Admin API data.
  The Shop is the Shop that the current user belongs to. For example, the shop that is using the app.
  This information is retrieved from the Authorization header, which is decoded from the request.
  The authorization header is added by App Bridge in the frontend code.
  NOTE: Getting started の通りにコピペしたもの。
        https://shopify.dev/apps/getting-started/build-app-example/backend
*/

import type { Express } from "express";

import { shopify } from "../shopify.ts";
import { QRCodesDB } from "../qr-codes-db.ts";
import {
  currentSession,
  errorMessage,
  getQrCodeOr404,
  getShopUrlFromSession,
  parseQrCodeBody,
  formatQrCodeResponse,
} from "../helpers/qr-codes.ts";

const DISCOUNTS_QUERY = `
  query discounts($first: Int!) {
    codeDiscountNodes(first: $first) {
      edges {
        node {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              codes(first: 1) {
                edges {
                  node {
                    code
                  }
                }
              }
            }
            ... on DiscountCodeBxgy {
              codes(first: 1) {
                edges {
                  node {
                    code
                  }
                }
              }
            }
            ... on DiscountCodeFreeShipping {
              codes(first: 1) {
                edges {
                  node {
                    code
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const PRODUCTS_COUNT_QUERY = `
  query productsCount {
    productsCount {
      count
    }
  }
`;

export default function applyQrCodeApiEndpoints(app: Express): void {
  app.get("/api/products/count", async (_req, res) => {
    const client = new shopify.api.clients.Graphql({
      session: currentSession(res),
    });
    const response = await client.request<{
      productsCount: { count: number };
    }>(PRODUCTS_COUNT_QUERY);

    res.status(200).send({ count: response.data?.productsCount.count });
  });

  app.get("/api/discounts", async (_req, res) => {
    const client = new shopify.api.clients.Graphql({
      session: currentSession(res),
    });

    /* Fetch all available discounts to list in the QR code form */
    const discounts = await client.request(DISCOUNTS_QUERY, {
      variables: {
        first: 25,
      },
    });

    res.send(discounts.data);
  });

  app.post("/api/qrcodes", async (req, res) => {
    try {
      const id = await QRCodesDB.create({
        ...parseQrCodeBody(req),

        /* Get the shop from the authorization header to prevent users from spoofing the data */
        shopDomain: getShopUrlFromSession(res),
      });
      const qrCode = await QRCodesDB.read(id);
      if (!qrCode) throw new Error(`QR code ${id} was not saved`);
      const response = await formatQrCodeResponse(res, [qrCode]);
      res.status(201).send(response[0]);
    } catch (error) {
      res.status(500).send(errorMessage(error));
    }
  });

  app.patch("/api/qrcodes/:id", async (req, res) => {
    const qrcode = await getQrCodeOr404(req, res);

    if (qrcode) {
      try {
        await QRCodesDB.update(req.params.id, parseQrCodeBody(req));
        const updated = await QRCodesDB.read(req.params.id);
        if (!updated) throw new Error(`QR code ${req.params.id} was not found`);
        const response = await formatQrCodeResponse(res, [updated]);
        res.status(200).send(response[0]);
      } catch (error) {
        res.status(500).send(errorMessage(error));
      }
    }
  });

  app.get("/api/qrcodes", async (req, res) => {
    try {
      const rawCodeData = await QRCodesDB.list(getShopUrlFromSession(res));

      const response = await formatQrCodeResponse(res, rawCodeData);
      res.status(200).send(response);
    } catch (error) {
      console.error(error);
      res.status(500).send(errorMessage(error));
    }
  });

  app.get("/api/qrcodes/:id", async (req, res) => {
    const qrcode = await getQrCodeOr404(req, res);

    if (qrcode) {
      const formattedQrCode = await formatQrCodeResponse(res, [qrcode]);
      res.status(200).send(formattedQrCode[0]);
    }
  });

  app.delete("/api/qrcodes/:id", async (req, res) => {
    const qrcode = await getQrCodeOr404(req, res);

    if (qrcode) {
      await QRCodesDB.delete(req.params.id);
      res.status(200).send();
    }
  });
}
