import { join } from "node:path";
import { ApiVersion } from "@shopify/shopify-api";
import { shopifyApp } from "@shopify/shopify-app-express";
import { SQLiteSessionStorage } from "@shopify/shopify-app-session-storage-sqlite";
import sqlite3 from "sqlite3";

import { QRCodesDB } from "./qr-codes-db.ts";

/*
  セッションと QR コードは同じ SQLite ファイルに保存します。
  SHOPIFY_API_KEY・SHOPIFY_API_SECRET・SCOPES・HOST は
  @shopify/shopify-app-express が環境変数から読み込みます。
*/
const database = new sqlite3.Database(join(process.cwd(), "database.sqlite"));

QRCodesDB.db = database;
QRCodesDB.init();

export const shopify = shopifyApp({
  api: {
    apiVersion: ApiVersion.October26,
  },
  auth: {
    path: "/api/auth",
    callbackPath: "/api/auth/callback",
  },
  webhooks: {
    path: "/api/webhooks",
  },
  sessionStorage: new SQLiteSessionStorage(database),
});
