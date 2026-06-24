import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "sonner/dist/styles.css";
import "streamdown/styles.css";
import "./styles.css";
import { App } from "./App";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
