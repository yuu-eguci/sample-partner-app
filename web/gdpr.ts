import { DeliveryMethod } from "@shopify/shopify-api";
import type { WebhookHandlersParam } from "@shopify/shopify-app-express";

/*
  必須の GDPR webhook のハンドラです。
  Partner Dashboard の「GDPR mandatory webhooks」に /api/webhooks を設定してください。
  顧客データを保存するようになったら、各ハンドラで対応する処理を実装してください。

  https://shopify.dev/apps/webhooks/configuration/mandatory-webhooks
*/
export const GDPRWebhookHandlers: WebhookHandlersParam = {
  /**
   * Customers can request their data from a store owner. When this happens,
   * Shopify invokes this webhook.
   *
   * Payload: { shop_id, shop_domain, orders_requested, customer: { id, email, phone }, data_request: { id } }
   *
   * https://shopify.dev/apps/webhooks/configuration/mandatory-webhooks#customers-data_request
   */
  CUSTOMERS_DATA_REQUEST: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async () => {},
  },

  /**
   * Store owners can request that data is deleted on behalf of a customer. When
   * this happens, Shopify invokes this webhook.
   *
   * Payload: { shop_id, shop_domain, customer: { id, email, phone }, orders_to_redact }
   *
   * https://shopify.dev/apps/webhooks/configuration/mandatory-webhooks#customers-redact
   */
  CUSTOMERS_REDACT: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async () => {},
  },

  /**
   * 48 hours after a store owner uninstalls your app, Shopify invokes this
   * webhook.
   *
   * Payload: { shop_id, shop_domain }
   *
   * https://shopify.dev/apps/webhooks/configuration/mandatory-webhooks#shop-redact
   */
  SHOP_REDACT: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async () => {},
  },
};
