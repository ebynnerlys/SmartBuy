import { defineContentScript } from "wxt/utils/define-content-script";
import {
  extractPageCacheFromPage,
  extractProductFromPage,
} from "../src/utils/extractProduct";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "smartbuy:extract-product") {
        return;
      }

      const product = extractProductFromPage();

      sendResponse({
        ok: true,
        product,
        pageCache: extractPageCacheFromPage(product),
      });
    });
  },
});
