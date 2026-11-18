/* バックエンド (web/) の API が返すデータの型です。 */

export interface QRCodeProduct {
  id?: string;
  title: string;
  handle?: string;
  images?: { edges: { node: { url: string } }[] };
}

/* GET /api/qrcodes・/api/qrcodes/:id が返す QR コードです。 */
export interface QRCode {
  id: number;
  title: string;
  shopDomain: string;
  variantId: string;
  handle: string;
  discountId: string;
  discountCode: string;
  destination: string;
  scans: number;
  createdAt: string;
  imageUrl?: string;
  product: QRCodeProduct;
}

/* GET /api/discounts が返す割引コードです。 */
export interface DiscountsResponse {
  codeDiscountNodes: {
    edges: {
      node: {
        id: string;
        codeDiscount: { codes: { edges: { node: { code: string } }[] } };
      };
    }[];
  };
}
