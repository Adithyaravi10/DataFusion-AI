import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { SessionProvider } from "./lib/session";
import { ThemeProvider } from "./lib/theme";
import { ToastProvider } from "./lib/toast";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <SessionProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </SessionProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
