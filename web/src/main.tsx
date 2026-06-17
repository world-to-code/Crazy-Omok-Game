import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GameProvider } from "./state/store";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GameProvider>
      <App />
    </GameProvider>
  </StrictMode>,
);
