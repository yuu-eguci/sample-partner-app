/*
  テスト用の共通セットアップです。
  アプリのモジュールは読み込み時に環境変数とカレントディレクトリを参照するため、
  テストファイルより先にこのファイルで準備します。
  Shopify への通信は globalThis.fetch を差し替えて、テストごとに定義した応答を返します。
*/
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

process.env.SHOPIFY_API_KEY = "test-api-key";
process.env.SHOPIFY_API_SECRET = "test-api-secret";
process.env.SCOPES = "write_products,read_discounts";
process.env.HOST = "https://app.example.test";
process.env.NODE_ENV = "test";

const workDir = mkdtempSync(join(tmpdir(), "sample-partner-app-test-"));
mkdirSync(join(workDir, "frontend"));
writeFileSync(
  join(workDir, "frontend", "index.html"),
  "<!DOCTYPE html><html><body>test index</body></html>"
);
process.chdir(workDir);

const unexpectedFetch = async (input) => {
  throw new Error(`Unexpected fetch in test: ${input}`);
};

globalThis.__shopifyFetchHandler = unexpectedFetch;
globalThis.fetch = (input, init) => globalThis.__shopifyFetchHandler(input, init);

afterEach(() => {
  globalThis.__shopifyFetchHandler = unexpectedFetch;
});
