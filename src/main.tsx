import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Wheel from "./Wheel";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {location.hash === "#wheel" ? <Wheel /> : <App />}
  </React.StrictMode>,
);
