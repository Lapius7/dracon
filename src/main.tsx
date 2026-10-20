import React from "react";
import ReactDOM from "react-dom/client";
import Wheel from "./Wheel";
import Splash from "./Splash";

const hash = location.hash;
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

if (hash === "#wheel") {
  root.render(<Wheel />);
} else if (hash === "#splash") {
  root.render(<Splash />);
} else {
  // メインウィンドウだけ共通スタイル（ダークテーマ）を読み込む
  void Promise.all([import("./index.css"), import("./App")]).then(([, { default: App }]) =>
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    ),
  );
}
