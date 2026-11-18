/*
  モックの Shopify 管理画面 (mock/shopify) に埋め込んだアプリを Chromium で操作し、
  主要な画面と QR コードの作成・編集・一覧・削除の流れを確認します。
  compose.mock.yaml の e2e サービスとして、外部に接続できない内部ネットワークで実行します。
*/
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const APP_URL = process.env.APP_URL;
const SHOP = process.env.MOCK_SHOP;
const API_KEY = process.env.MOCK_API_KEY;
const API_SECRET = process.env.MOCK_API_SECRET;
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? "/tmp/screenshots";
const ADMIN_URL = `https://${SHOP}/admin/apps/${API_KEY}`;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

let step = 0;
function log(message) {
  step += 1;
  console.info(`ok ${step} - ${message}`);
}

async function uninstall() {
  const body = JSON.stringify({ domain: SHOP });
  const response = await fetch(`${APP_URL}/api/webhooks`, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Topic": "app/uninstalled",
      "X-Shopify-Shop-Domain": SHOP,
      "X-Shopify-API-Version": "2026-10",
      "X-Shopify-Webhook-Id": crypto.randomUUID(),
      "X-Shopify-Hmac-Sha256": createHmac("sha256", API_SECRET).update(body).digest("base64"),
    },
  });
  assert.equal(response.status, 200);
}

mkdirSync(SCREENSHOT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  ignoreHTTPSErrors: true,
  viewport: { width: 1280, height: 900 },
  // Shopify のライブラリはヘッドレスブラウザの User-Agent をボットとみなして OAuth を拒否するためです。
  userAgent: USER_AGENT,
});
// モック以外 (実際の Shopify の CDN など) へのリクエストは送らずに中断します。
const ALLOWED_HOSTS = new Set([SHOP, new URL(APP_URL).host]);
const blockedRequests = [];
await page.route("**/*", (route) => {
  const url = new URL(route.request().url());
  if (ALLOWED_HOSTS.has(url.host) || url.protocol === "data:") return route.continue();
  blockedRequests.push(url.origin);
  return route.abort("blockedbyclient");
});
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error));
page.on("console", (message) => {
  if (message.type() === "error") console.error(`[browser] ${message.text()}`);
});

const app = page.frameLocator("#app-frame");
const titleBar = page.locator("#title-bar");
const screenshot = (name) =>
  page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png`, fullPage: true });

try {
  // OAuth によるインストール (モックが自動で承認し、管理画面のアプリへ戻ります)
  await page.goto(`${APP_URL}/api/auth?shop=${SHOP}`);
  await page.waitForURL(ADMIN_URL);
  log("OAuth installs the app and opens it in the mock Shopify admin");

  // 一覧 (空の状態)
  await app.getByText("Create unique QR codes for your product").waitFor();
  await titleBar.filter({ hasText: "QR codes" }).waitFor();
  await screenshot("01-empty-list");
  log("the QR code list shows the empty state");

  // 作成画面
  await app.getByRole("button", { name: "Create QR code" }).click();
  await titleBar.filter({ hasText: "Create new QR code" }).waitFor();
  await app.getByLabel("Title").fill("Browser QR code");
  await app.getByRole("button", { name: "Select product" }).first().click();
  await app.getByText("Mock T-shirt").waitFor();
  await app.getByLabel("discount code").selectOption({ label: "MOCK10" });
  await screenshot("02-new-form");
  log("the create form selects a product and a discount");

  await page.locator("#save-bar-save").click();
  await titleBar.filter({ hasText: "Edit QR code" }).waitFor();
  const qrImage = app.locator('img[src*="/qrcodes/"][src$="/image"]');
  await qrImage.waitFor();
  assert.ok(
    await qrImage.evaluate((img) => img.complete && img.naturalWidth > 0),
    "the QR code image is loaded"
  );
  await screenshot("03-created");
  log("saving creates the QR code and opens the edit page with its image");

  // 編集
  await app.getByLabel("Title").fill("Browser QR code (edited)");
  await app.getByText("Link to checkout page with product in the cart").click();
  assert.ok(await app.getByLabel("Link to checkout page with product in the cart").isChecked());
  await page.locator("#save-bar-save").click();
  await page.locator("#save-bar").waitFor({ state: "hidden" });
  log("editing and saving updates the QR code");

  // 一覧
  await page.goto(ADMIN_URL);
  const row = app.getByRole("row", { name: /Browser QR code \(edited\)/ });
  await row.waitFor();
  const rowText = await row.innerText();
  assert.match(rowText, /Mock T-shirt/);
  assert.match(rowText, /MOCK10/);
  await screenshot("04-list");
  log("the list shows the edited QR code with its product and discount");

  // 削除
  await row.getByText("Browser QR code (edited)").click();
  await titleBar.filter({ hasText: "Edit QR code" }).waitFor();
  await app.getByRole("button", { name: "Delete QR code" }).click();
  await app.getByText("Create unique QR codes for your product").waitFor();
  log("deleting the QR code returns to the empty list");

  // 存在しないページ
  await page.goto(`${ADMIN_URL}/does-not-exist`);
  await app.getByText("There is no page at this address").waitFor();
  await screenshot("05-not-found");
  log("unknown paths show the not found page");

  assert.deepEqual(pageErrors, [], "no uncaught errors in the page");
  console.info(`blocked non-mock requests: ${[...new Set(blockedRequests)].join(", ") || "none"}`);
} catch (error) {
  await screenshot("failure").catch(() => {});
  throw error;
} finally {
  await browser.close();
  await uninstall();
}

console.info("E2E test passed");
