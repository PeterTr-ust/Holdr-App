import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Fonts are bundled with the app so it never contacts a font CDN.
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "./styles/app.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
