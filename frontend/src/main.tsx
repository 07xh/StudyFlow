import React from "react";
import {createRoot} from "react-dom/client";
import App from "./App";
import "./style.css";

const notifyStartupReady = () => {
  (window as Window & {studyflowStartupReady?: () => void}).studyflowStartupReady?.();
};

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App onStartupReady={notifyStartupReady}/></React.StrictMode>
);
