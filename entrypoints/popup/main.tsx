import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("No se encontró el contenedor del popup.");
}

createRoot(container).render(<App />);
