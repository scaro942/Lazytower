import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// 번들에 포함되는 폰트 (오프라인·자립형, CDN 불필요)
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/noto-sans-kr/400.css";
import "@fontsource/noto-sans-kr/500.css";
import "@fontsource/noto-sans-kr/700.css";

import "./styles.css";
import { TowerGame } from "./components/TowerGame";
import { preloadSprites } from "./lib/game/tower";

preloadSprites();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TowerGame />
  </StrictMode>
);
