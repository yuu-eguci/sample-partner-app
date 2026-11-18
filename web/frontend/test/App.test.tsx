import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "../App";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  // AppBridgeProvider caches the host on window so that it survives navigation.
  delete window.__SHOPIFY_DEV_HOST;
});

describe("App", () => {
  it("asks for the API key when the app was built without it", () => {
    vi.stubEnv("SHOPIFY_API_KEY", "");
    window.history.pushState({}, "", "/?host=dGVzdA");
    render(<App />);
    expect(screen.getByText("Missing Shopify API Key")).toBeTruthy();
  });

  it("asks for the host query when opened outside the Shopify admin", () => {
    vi.stubEnv("SHOPIFY_API_KEY", "test-api-key");
    window.history.pushState({}, "", "/");
    render(<App />);
    expect(screen.getByText("Missing host query argument")).toBeTruthy();
  });
});
