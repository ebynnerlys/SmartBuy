import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: ".",
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "SmartBuy",
    short_name: "SmartBuy",
    description:
      "Cesta inteligente para guardar, comparar y recomendar compras online.",
    permissions: ["storage", "tabs", "activeTab", "contextMenus"],
    host_permissions: ["<all_urls>"],
    action: {
      default_title: "SmartBuy",
    },
  },
});
