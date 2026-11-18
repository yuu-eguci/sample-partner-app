import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import Routes from "../Routes";

afterEach(cleanup);

/* import.meta.glob({ eager: true }) と同じ形のページ一覧です。 */
const pages = {
  "./pages/index.jsx": { default: () => <p>home page</p> },
  "./pages/NotFound.jsx": { default: () => <p>not found page</p> },
  "./pages/ExitIframe.jsx": { default: () => <p>exit iframe page</p> },
  "./pages/qrcodes/new.jsx": { default: () => <p>new QR code page</p> },
  "./pages/qrcodes/[id].jsx": { default: () => <p>edit QR code page</p> },
};

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes pages={pages} />
    </MemoryRouter>
  );
}

describe("Routes", () => {
  it.each([
    ["/", "home page"],
    ["/exitiframe", "exit iframe page"],
    ["/qrcodes/new", "new QR code page"],
    ["/qrcodes/42", "edit QR code page"],
    ["/does/not/exist", "not found page"],
  ])("renders %s", (path, text) => {
    renderAt(path);
    expect(screen.getByText(text)).toBeTruthy();
  });

  it("ignores modules without a default export", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes pages={{ ...pages, "./pages/helper.jsx": {} }} />
      </MemoryRouter>
    );
    expect(screen.getByText("home page")).toBeTruthy();
    expect(warn).toHaveBeenCalledWith(
      "./pages/helper.jsx doesn't export a default React component"
    );
    warn.mockRestore();
  });
});
