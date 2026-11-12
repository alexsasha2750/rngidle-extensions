# RNGidle Shop Helper

A Chrome extension for selecting items from Glim's main shop and automatically buying them while an RNGidle tab is open. It does not buy from the black market, Glitch, the Halloween shop, or bundles.

> **Account risk:** RNGidle's [terms](https://rngidle.fun/terms) prohibit bots, scripts, auto-clickers, and tools that play for you. Automatic buying may violate those terms and could result in a progress reset or ban. Use only if you accept that risk.

## Install

1. Open `chrome://extensions` in Chrome 120 or later.
2. Turn on **Developer mode**, choose **Load unpacked**, and select the `shop-helper` folder.
3. Open and sign in to `https://rngidle.fun/`. Keep a game tab open, but you can visit another page within the game.
4. Open the extension, select one or more items, set quantities and modes, enable automatic purchases, and save.

The extension starts paused. It checks about once a minute while Chrome is running; it does not work after the game tab or Chrome is closed. A check is also triggered when a game tab opens or settings are saved. The game server remains responsible for purchases and can reject them.

## How buying works

- **Buy once** purchases up to the chosen quantity when possible, then stops for that item. Use **Rearm once** to allow another purchase.
- **Every new shop restock** purchases up to the chosen quantity once per shop or shop reroll, when the item is in stock and you can afford it. A quantity can be limited by your EP, stock, or the game's per-player limits.
- Rules are tied to the first signed-in account used after enabling the extension. To switch accounts, pause it, remove all items and save, sign in to the other account, and set up the list again.
- If a purchase response is lost, the extension keeps the same request ID when retrying. If the result cannot be established, inspect your inventory before removing and re-adding the item. A request already in flight may finish after you pause.
- The item list and displayed prices are a snapshot. To reduce the chance of spending against stale prices, purchases stop if the site's shop catalog changes; the extension must then be updated before it can buy again.

Settings, status, and purchase activity are stored locally in the browser. The extension uses the game's existing signed-in session from its open tab and requests access only to `rngidle.fun`. It does not ask for or store credentials.

## Checks

Run `npm test` with Node.js to exercise the purchase planning and background flow using simulated responses; no live purchases are made by these tests. The live signed-in purchase endpoint has not been verified by these tests.

## License and attribution

The original extension code is available under the [MIT License](LICENSE). The bundled item names and prices are a snapshot of the public RNGidle shop catalog; RNGidle and its game content belong to their respective owners. This project is not affiliated with RNGidle.
