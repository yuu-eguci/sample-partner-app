Shopify custom app sample - sample-partner-app
===

👜 Shopify custom app を試しに作ってみた。不必要であれば関わりを持ちたくないようなドキュメントだった。

https://shopify.dev/apps/getting-started

## 構成

| パス | 内容 |
| --- | --- |
| `web/` | Express によるバックエンド (`npm run serve` で起動します)。Shopify との認証・セッション管理は `@shopify/shopify-app-express` を使い、QR コードとセッションを SQLite (`web/database.sqlite`) に保存します。 |
| `web/frontend/` | React + Vite によるフロントエンド (埋め込みアプリの画面)。`npm run build` で `web/frontend/dist/` に出力し、本番ではバックエンドが配信します。 |
| `extensions/` | テーマアプリ拡張機能。 |
| `mock/shopify/` | 動作確認用のモック Shopify (Admin API・OAuth)。本番 image には含めません。 |
| `Dockerfile` | 本番用 image。`web/` の依存をインストールし、フロントエンドをビルドしてバックエンドを起動します。 |
| `compose.yaml` / `compose.mock.yaml` | Docker Compose の定義。`compose.mock.yaml` はモック Shopify で動作確認するための追加定義です。 |

## 動作環境

- Node.js 26 (Active LTS)
- npm 12

ホストに Node.js がなくても、以下の Docker の手順だけで build・起動・テストができます。

## Docker で起動する

Docker と Docker Compose が必要です。

1. `.env.example` をコピーして `.env` を作成し、Partner Dashboard のアプリの値を設定します。`.env` は git にも image にも含めません。

    ```bash
    cp .env.example .env
    ```

    | 変数 | 内容 |
    | --- | --- |
    | `SHOPIFY_API_KEY` | アプリの API キー (Client ID)。フロントエンドのビルド時にも使います。 |
    | `SHOPIFY_API_SECRET` | アプリの API シークレット。実行時のみ渡します。 |
    | `SCOPES` | アクセススコープ (例: `write_products,read_discounts`)。 |
    | `HOST` | アプリの公開 URL (例: `https://example.com`)。 |

2. image を build して起動します。

    ```bash
    docker compose up --build
    ```

    バックエンドは http://localhost:8081 で待ち受けます。`curl http://localhost:8081/health` が 200 を返せば起動しています。
    セッションと QR コードはコンテナ内の SQLite (`/app/database.sqlite`) に保存されるため、コンテナを削除すると消えます。

3. 停止します。

    ```bash
    docker compose down
    ```

## モック Shopify で動作確認する

実際の Shopify には接続せず、モックの OAuth・Admin API を使って動作確認できます。

```bash
docker compose -f compose.yaml -f compose.mock.yaml up --build -d --wait
docker compose -f compose.yaml -f compose.mock.yaml run --rm smoke
```

- アプリは API キー `mock-api-key` でビルドされ、http://localhost:8081 で待ち受けます (`HOST` は compose のネットワーク内の `http://app:8081` です)。
- モック Shopify (`mock/shopify/`) は外部に接続できない内部ネットワークにだけ参加し、その中で `mock-shop.myshopify.com` として応答します。自己署名証明書は起動時に生成され、アプリには `NODE_EXTRA_CA_CERTS` で渡されます。
- `smoke` (`mock/smoke-test.mjs`) は、同じネットワーク内から次の流れを HTTP で確認します。
    - `/health`
    - OAuth によるインストール (モックが自動で承認します)
    - 埋め込みアプリの HTML とビルド済みフロントエンドの配信
    - 商品数・割引の取得と QR コードの作成・一覧・更新・削除
    - QR コード画像の取得とスキャン時のリダイレクト
    - アンインストール webhook によるセッション削除

`mock-shop.myshopify.com` はホストのブラウザからは実際の Shopify のドメインとして解決されるため、ホストのブラウザでモックの OAuth を開かないでください。

停止するときは、証明書のボリュームも削除します。

```bash
docker compose -f compose.yaml -f compose.mock.yaml down -v
```

## テストとビルド

ホストに Node.js がない場合は、`node:26-alpine` コンテナの中で実行します。

```bash
docker run --rm -v "$PWD/web:/app" -w /app node:26-alpine \
  sh -c 'npm install -g npm@12 && npm ci && npm test'
docker run --rm -v "$PWD/web/frontend:/app" -w /app node:26-alpine \
  sh -c 'npm install -g npm@12 && npm ci && SHOPIFY_API_KEY=dummy npm run build'
```

`Dockerfile.dev` は、`web/` をボリュームでマウントして起動時にインストール・ビルドする開発用 image です。

```bash
docker build -f Dockerfile.dev -t sample-partner-app-dev .
docker run --rm --env-file .env -e PORT=8081 -p 8081:8081 -v "$PWD/web:/app" sample-partner-app-dev
```

CI (`.github/workflows/ci.yml`) では、PR と main への push のたびに上記のテスト・ビルドと、モック Shopify を使った Docker Compose の起動確認 (`smoke`) を行います。

## デプロイ

`.github/workflows/` のデプロイ用 workflow (Amazon ECS・Elastic Beanstalk・拡張機能) は、いずれも手動実行 (`workflow_dispatch`) のみです。
