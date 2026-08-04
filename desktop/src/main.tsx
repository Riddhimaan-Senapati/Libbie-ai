import React from "react";
import ReactDOM from "react-dom/client";

// Self-hosted fonts (no runtime network), restricted to the used Latin WOFF2
// faces for the Chromium-based desktop webview.
import "@/styles/fonts.css";

import App from "@/App";
import "@/styles/globals.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
