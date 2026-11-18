/*
  NOTE: Getting started の通りにコピペしたもの。
        https://shopify.dev/apps/getting-started/build-app-example/backend
*/

import type { Request, Response } from "express";
import type { Session } from "@shopify/shopify-api";

import { shopify } from "../shopify.ts";
import { QRCodesDB, type QrCodeFields, type QrCodeRecord } from "../qr-codes-db.ts";

/*
  The app's database stores the productId and the discountId.
  This query is used to get the fields the frontend needs for those IDs.
  By querying the Shopify GraphQL Admin API at runtime, data can't become stale.
  This data is also queried so that the full state can be saved to the database, in order to generate QR code links.
*/
const QR_CODE_ADMIN_QUERY = `
  query nodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        handle
        title
        images(first: 1) {
          edges {
            node {
              url
            }
          }
        }
      }
      ... on ProductVariant {
        id
      }
      ... on DiscountCodeNode {
        id
      }
    }
  }
`;

/* Admin API の nodes クエリが返す商品・バリエーション・割引です (削除済みのものは null)。 */
type AdminNode = {
  id: string;
  title?: string;
  handle?: string;
  images?: { edges: { node: { url: string } }[] };
} | null;

export type FormattedQrCode = Omit<QrCodeRecord, "productId"> & {
  product: NonNullable<AdminNode> | { title: string };
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* validateAuthenticatedSession() が res.locals.shopify.session に設定したセッションです。 */
export function currentSession(res: Response): Session {
  return res.locals.shopify.session;
}

export async function getQrCodeOr404(
  req: Request<{ id: string }>,
  res: Response,
  checkDomain = true
): Promise<QrCodeRecord | undefined> {
  try {
    const response = await QRCodesDB.read(req.params.id);
    if (
      response === undefined ||
      (checkDomain &&
        getShopUrlFromSession(res) !== response.shopDomain)
    ) {
      res.status(404).send();
    } else {
      return response;
    }
  } catch (error) {
    res.status(500).send(errorMessage(error));
  }

  return undefined;
}

/* 現在のセッションのショップの URL です。 */
export function getShopUrlFromSession(res: Response): string {
  return `https://${currentSession(res).shop}`;
}

/*
Expect body to contain
title: string
productId: string
variantId: string
handle: string
discountId: string
discountCode: string
destination: string
*/
export function parseQrCodeBody(req: Request): QrCodeFields {
  return {
    title: req.body.title,
    productId: req.body.productId,
    variantId: req.body.variantId,
    handle: req.body.handle,
    discountId: req.body.discountId,
    discountCode: req.body.discountCode,
    destination: req.body.destination,
  };
}

/*
  Replaces the productId with product data queried from the Shopify GraphQL Admin API
*/
export async function formatQrCodeResponse(
  res: Response,
  rawCodeData: QrCodeRecord[]
): Promise<FormattedQrCode[]> {
  const ids: string[] = [];

  /* Get every product, variant and discountID that was queried from the database */
  rawCodeData.forEach(({ productId, discountId, variantId }) => {
    ids.push(productId);
    ids.push(variantId);

    if (discountId) {
      ids.push(discountId);
    }
  });

  /* Instantiate a new GraphQL client to query the Shopify GraphQL Admin API */
  const client = new shopify.api.clients.Graphql({
    session: currentSession(res),
  });

  /* Query the Shopify GraphQL Admin API */
  const adminData = await client.request<{ nodes: AdminNode[] }>(
    QR_CODE_ADMIN_QUERY,
    {
    /* The IDs that are pulled from the app's database are used to query product, variant and discount information */
      variables: { ids },
    }
  );
  const nodes = adminData.data?.nodes ?? [];

  /*
    Replace the product, discount and variant IDs with the data fetched using the Shopify GraphQL Admin API.
  */
  const formattedData = rawCodeData.map((qrCode) => {
    const product = nodes.find((node) => qrCode.productId === node?.id) || {
      title: "Deleted product",
    };

    const discountDeleted =
      qrCode.discountId &&
      !nodes.find((node) => qrCode.discountId === node?.id);

    /*
      A user might create a QR code with a discount code and then later delete that discount code.
      For optimal UX it's important to handle that edge case.
      Use mock data so that the frontend knows how to interpret this QR Code.
    */
    if (discountDeleted) {
      QRCodesDB.update(qrCode.id, {
        ...qrCode,
        discountId: "",
        discountCode: "",
      });
    }

    /*
      Merge the data from the app's database with the data queried from the Shopify GraphQL Admin API
    */
    /* Since product.id already exists, productId isn't required */
    const { productId: _productId, ...qrCodeWithoutProductId } = qrCode;

    return {
      ...qrCodeWithoutProductId,
      product,
      discountCode: discountDeleted ? "" : qrCode.discountCode,
    };
  });

  return formattedData;
}
