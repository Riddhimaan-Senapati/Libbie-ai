import React from "react";
import ReactDOM from "react-dom/client";
import { LazyMotion, domAnimation, MotionConfig } from "motion/react";

// Self-hosted fonts (no runtime network), restricted to the used Latin WOFF2
// faces for the Chromium-based desktop webview.
import "@/styles/fonts.css";

import App from "@/App";
import "@/styles/globals.css";

// LazyMotion + `m` components load only the domAnimation feature set (~half of
// the full motion bundle); every spring/fade here is covered by it.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </LazyMotion>
  </React.StrictMode>,
);
