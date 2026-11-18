/*
  This file interacts with the app's database and is used by the app's REST APIs.
  NOTE: Getting started の通りにコピペしたもの。
        https://shopify.dev/apps/getting-started/build-app-example/backend
*/

const DEFAULT_PURCHASE_QUANTITY = 1;

/* QR コードの画像・スキャン用 URL に使うアプリの公開 URL です。 */
function appUrl() {
  return process.env.HOST.replace(/\/$/, "");
}

export const QRCodesDB = {
  qrCodesTableName: "qr_codes",
  db: null,
  ready: null,

  create: async function ({
    shopDomain,
    title,
    productId,
    variantId,
    handle,
    discountId,
    discountCode,
    destination,
  }) {
    await this.ready;

    const query = `
      INSERT INTO ${this.qrCodesTableName}
      (shopDomain, title, productId, variantId, handle, discountId, discountCode, destination, scans)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      RETURNING id;
    `;

    const rawResults = await this.__query(query, [
      shopDomain,
      title,
      productId,
      variantId,
      handle,
      discountId,
      discountCode,
      destination,
    ]);

    return rawResults[0].id;
  },

  update: async function (
    id,
    {
      title,
      productId,
      variantId,
      handle,
      discountId,
      discountCode,
      destination,
    }
  ) {
    await this.ready;

    const query = `
      UPDATE ${this.qrCodesTableName}
      SET
        title = ?,
        productId = ?,
        variantId = ?,
        handle = ?,
        discountId = ?,
        discountCode = ?,
        destination = ?
      WHERE
        id = ?;
    `;

    await this.__query(query, [
      title,
      productId,
      variantId,
      handle,
      discountId,
      discountCode,
      destination,
      id,
    ]);
    return true;
  },

  list: async function (shopDomain) {
    await this.ready;
    const query = `
      SELECT * FROM ${this.qrCodesTableName}
      WHERE shopDomain = ?;
    `;

    const results = await this.__query(query, [shopDomain]);

    return results.map((qrcode) => this.__addImageUrl(qrcode));
  },

  read: async function (id) {
    await this.ready;
    const query = `
      SELECT * FROM ${this.qrCodesTableName}
      WHERE id = ?;
    `;
    const rows = await this.__query(query, [id]);
    if (!Array.isArray(rows) || rows?.length !== 1) return undefined;

    return this.__addImageUrl(rows[0]);
  },

  delete: async function (id) {
    await this.ready;
    const query = `
      DELETE FROM ${this.qrCodesTableName}
      WHERE id = ?;
    `;
    await this.__query(query, [id]);
    return true;
  },

  /* The destination URL for a QR code is generated at query time */
  generateQrcodeDestinationUrl: function (qrcode) {
    return `${appUrl()}/qrcodes/${qrcode.id}/scan`;
  },

  /* The behavior when a QR code is scanned */
  handleCodeScan: async function (qrcode) {

    /* Log the scan in the database */
    await this.__increaseScanCount(qrcode);

    const url = new URL(qrcode.shopDomain);
    switch (qrcode.destination) {

      /* The QR code redirects to the product view */
      case "product":
        return this.__goToProductView(url, qrcode);

      /* The QR code redirects to checkout */
      case "checkout":
        return this.__goToProductCheckout(url, qrcode);

      default:
        throw `Unrecognized destination "${qrcode.destination}"`;
    }
  },

  /*
    Creates the QR code table on the database assigned to `db` if it hasn't been created.
    The CRUD methods wait for `ready`, so they never run before the table exists.
  */
  init: function () {
    const query = `
      CREATE TABLE IF NOT EXISTS ${this.qrCodesTableName} (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        shopDomain VARCHAR(511) NOT NULL,
        title VARCHAR(511) NOT NULL,
        productId VARCHAR(255) NOT NULL,
        variantId VARCHAR(255) NOT NULL,
        handle VARCHAR(255) NOT NULL,
        discountId VARCHAR(255) NOT NULL,
        discountCode VARCHAR(255) NOT NULL,
        destination VARCHAR(255) NOT NULL,
        scans INTEGER,
        createdAt DATETIME NOT NULL DEFAULT (datetime(CURRENT_TIMESTAMP, 'localtime'))
      )
    `;

    this.ready = this.__query(query);
    return this.ready;
  },

  /* Private */

  /* Perform a query on the database. Used by the various CRUD methods. */
  __query: function (sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, result) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(result);
      });
    });
  },

  __addImageUrl: function (qrcode) {
    try {
      qrcode.imageUrl = this.__generateQrcodeImageUrl(qrcode);
    } catch (err) {
      console.error(err);
    }

    return qrcode;
  },

  __generateQrcodeImageUrl: function (qrcode) {
    return `${appUrl()}/qrcodes/${qrcode.id}/image`;
  },

  __increaseScanCount: async function (qrcode) {
    const query = `
      UPDATE ${this.qrCodesTableName}
      SET scans = scans + 1
      WHERE id = ?
    `;
    await this.__query(query, [qrcode.id]);
  },

  __goToProductView: function (url, qrcode) {
    return productViewURL({
      discountCode: qrcode.discountCode,
      host: url.toString(),
      productHandle: qrcode.handle,
    });
  },

  __goToProductCheckout: function (url, qrcode) {
    return productCheckoutURL({
      discountCode: qrcode.discountCode,
      host: url.toString(),
      variantId: qrcode.variantId,
      quantity: DEFAULT_PURCHASE_QUANTITY,
    });
  },
};

/* Generate the URL to a product page */
function productViewURL({ host, productHandle, discountCode }) {
  const url = new URL(host);
  const productPath = `/products/${productHandle}`;

  /* If this QR Code has a discount code, then add it to the URL */
  if (discountCode) {
    url.pathname = `/discount/${discountCode}`;
    url.searchParams.append("redirect", productPath);
  } else {
    url.pathname = productPath;
  }

  return url.toString();
}

/* Generate the URL to checkout with the product in the cart */
function productCheckoutURL({ host, variantId, quantity = 1, discountCode }) {
  const url = new URL(host);
  const id = variantId.replace(
    /gid:\/\/shopify\/ProductVariant\/([0-9]+)/,
    "$1"
  );

  /* The cart URL resolves to a checkout URL */
  url.pathname = `/cart/${id}:${quantity}`;

  if (discountCode) {
    url.searchParams.append("discount", discountCode);
  }

  return url.toString();
}
