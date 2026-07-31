---
"nanoclaw-agenthosts": patch
---

Scope `restoreStockPollActiveBody` to the `pollActive` function so uninstall does not leave an empty try when `pollSweep` still calls `deliverSessionMessages`.
