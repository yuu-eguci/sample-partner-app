Shopify custom app sample - sample-partner-app
===

👜 Shopify custom app を試しに作ってみた。不必要であれば関わりを持ちたくないようなドキュメントだった。

https://shopify.dev/apps/getting-started

## 構成

| パス | 内容 |
| --- | --- |
| `web/` | Express + TypeScript によるバックエンド (`npm run serve` で起動します)。Node.js 26 の型ストリップ機能で `.ts` をビルドせずに直接実行します。Shopify との認証・セッション管理は `@shopify/shopify-app-express` を使い、QR コードとセッションを SQLite (`web/database.sqlite`) に保存します。 |
| `web/frontend/` | React 18 + TypeScript + Vite + Polaris + App Bridge (v3) によるフロントエンド (埋め込みアプリの画面)。`npm run build` で `web/frontend/dist/` に出力し、本番ではバックエンドが配信します。 |
| `extensions/` | テーマアプリ拡張機能。 |
| `mock/shopify/` | 動作確認用のモック Shopify (OAuth・Admin API・管理画面・アプリへの HTTPS プロキシ)。本番 image には含めません。 |
| `mock/smoke-test.mjs` / `mock/e2e/` | モック Shopify を相手にした HTTP の smoke テストと、Playwright (Chromium) によるブラウザの e2e テスト。アプリとは別のコンテナで動く検証用スクリプトのため、JavaScript のままです。 |
| `Dockerfile` | 本番用 image。`web/` の依存をインストールし、フロントエンドをビルドしてバックエンドを起動します。 |
| `compose.yaml` / `compose.mock.yaml` | Docker Compose の定義。`compose.mock.yaml` はモック Shopify で動作確認するための追加定義です。 |

## 動作環境

- Node.js 26 (Active LTS)
- npm 12
- TypeScript 7 (型チェックのみ。`npm run typecheck` で実行します)

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

実際の Shopify には接続せず、モックの OAuth・Admin API・管理画面を使って動作確認できます。

```bash
docker compose -f compose.yaml -f compose.mock.yaml up --build -d --wait
docker compose -f compose.yaml -f compose.mock.yaml run --rm smoke
docker compose -f compose.yaml -f compose.mock.yaml run --rm e2e
```

- アプリは API キー `mock-api-key` でビルドされ、http://localhost:8081 で待ち受けます。
- モック Shopify (`mock/shopify/`) は外部に接続できない内部ネットワークにだけ参加し、その中で次の名前で応答します。自己署名証明書は起動時に生成され、アプリとテスト用コンテナには `NODE_EXTRA_CA_CERTS` で渡されます。
    - `https://mock-shop.myshopify.com`: OAuth (自動で承認)・Admin GraphQL API・ストアフロント、および `/admin/apps/mock-api-key/` でアプリを iframe に埋め込む管理画面。管理画面は App Bridge (v3) のセッショントークン・画面遷移・リソースピッカー・保存バーなどのメッセージに応答します。
    - `https://secure-partner-app:8443`: アプリ (`http://app:8081`) への HTTPS リバースプロキシ。アプリの `HOST` はこの URL です (実際の Shopify と同じく、https の管理画面から https のアプリを埋め込むためです)。
- `smoke` (`mock/smoke-test.mjs`) は、同じネットワーク内から次の流れを HTTP で確認します。
    - `/health`
    - OAuth によるインストール
    - 埋め込みアプリの HTML とビルド済みフロントエンドの配信
    - 商品数・割引の取得と QR コードの作成・一覧・更新・削除
    - QR コード画像の取得とスキャン時のリダイレクト
    - アンインストール webhook によるセッション削除
- `e2e` (`mock/e2e/e2e.mjs`) は、Chromium でモックの管理画面を開き、次の流れを画面操作で確認します。モック以外へのリクエストはブラウザ内で中断します。`SCREENSHOT_DIR` を指定すると各画面のスクリーンショットを保存します。
    - ブラウザでの OAuth インストール
    - QR コード一覧 (空の状態)
    - 作成画面での商品・割引の選択と保存、QR コード画像の表示
    - 編集・保存、一覧への反映
    - 削除
    - 存在しないページ
- `smoke` と `e2e` は、QR コードが登録されていない状態から始まることを前提にしています。途中で失敗した場合は `up --force-recreate` でアプリのコンテナを作り直してください。

`mock-shop.myshopify.com` はホストのブラウザからは実際の Shopify のドメインとして解決されるため、ホストのブラウザでモックの OAuth や管理画面を開かないでください。

停止するときは、証明書のボリュームも削除します。

```bash
docker compose -f compose.yaml -f compose.mock.yaml down -v
```

## テストとビルド

ホストに Node.js がない場合は、`node:26-alpine` コンテナの中で実行します。

```bash
docker run --rm -v "$PWD/web:/app" -w /app node:26-alpine \
  sh -c 'npm install -g npm@12 && npm ci && npm run typecheck && npm test'
docker run --rm -v "$PWD/web/frontend:/app" -w /app node:26-alpine \
  sh -c 'npm install -g npm@12 && npm ci && npm run typecheck && npm test && SHOPIFY_API_KEY=dummy npm run build'
```

`Dockerfile.dev` は、`web/` をボリュームでマウントして起動時にインストール・ビルドする開発用 image です。

```bash
docker build -f Dockerfile.dev -t sample-partner-app-dev .
docker run --rm --env-file .env -e PORT=8081 -p 8081:8081 -v "$PWD/web:/app" sample-partner-app-dev
```

CI (`.github/workflows/ci.yml`) では、PR と main への push のたびに上記の型チェック・テスト・ビルドと、モック Shopify を使った Docker Compose の起動確認 (`smoke`)・ブラウザでの動作確認 (`e2e`) を行います。

## デプロイ

`.github/workflows/` のデプロイ用 workflow は、いずれも手動実行 (`workflow_dispatch`) のみです。

| workflow | 内容 |
| --- | --- |
| `cd-elastic-beanstalk.yml` | Node.js 26 で `web/` の依存をインストールし、フロントエンドをビルドして `web/` を zip にし、Elastic Beanstalk にデプロイします。Elastic Beanstalk は arm64 のため、`npm_config_arch=arm64` で sqlite3 の linux arm64 用ビルド済みバイナリを取得します。Elastic Beanstalk の環境は Node.js 26 のプラットフォームである必要があります。 |
| `aws.yml` | `Dockerfile` の image を Amazon ECR に push し、Amazon ECS にデプロイします。 |
| `deploy-extensions.yml` | ルートの Shopify CLI で拡張機能をデプロイします。 |

ルートの `package.json` の Shopify CLI (`@shopify/cli` 3.20.1) は、`client_id` を含まない旧形式の `shopify.app.toml` を前提としています。現行の Shopify CLI はアプリと紐づけた形式 (`client_id`・`application_url`・`[auth]`・`[webhooks]` など) の設定を必須としており、移行には Partner Dashboard のアプリとの紐づけ (`shopify app config link`) が必要なため、旧バージョンのままにしています。
