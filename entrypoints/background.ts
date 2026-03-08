import { defineBackground } from "wxt/utils/define-background";

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: "smartbuy-open-dashboard",
        title: "Abrir comparador de SmartBuy",
        contexts: ["action", "page"],
      });
    });
  });

  chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === "smartbuy-open-dashboard") {
      chrome.runtime.openOptionsPage();
    }
  });
});
