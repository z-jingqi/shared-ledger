import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "sonner/dist/styles.css";
import "streamdown/styles.css";
import "./styles.css";
import "./styles.ios.css";
import "./styles.core-tabs.css";
import "./styles.records-ios.css";
import "./styles.account-ai.css";
import { App } from "./App";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
