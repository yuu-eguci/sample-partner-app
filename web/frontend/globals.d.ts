/*
  フロントエンド全体で使うグローバルな値の型です。
  process.env.SHOPIFY_API_KEY は vite.config.ts の define でビルド時に埋め込まれます。
*/
interface Window {
  /* AppBridgeProvider が、画面遷移で URL から消えても失われないように保持する host です。 */
  __SHOPIFY_DEV_HOST?: string | null;
}
