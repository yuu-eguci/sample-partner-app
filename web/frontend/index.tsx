import { createRoot } from "react-dom/client";

import App from "./App";

const container = document.getElementById("app");
if (!container) throw new Error("#app element is missing in index.html");

createRoot(container).render(<App />);
