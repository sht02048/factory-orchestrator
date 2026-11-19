import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NOTIFICATION_SETTINGS_WINDOW } from "../shared/view";
import { App } from "./app";
import { NotificationSettingsWindow } from "./notification-settings";
import "./app.css";

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      {new URLSearchParams(window.location.search).get("window") ===
      NOTIFICATION_SETTINGS_WINDOW ? (
        <NotificationSettingsWindow />
      ) : (
        <App />
      )}
    </StrictMode>,
  );
}
