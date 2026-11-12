# RNGidle Shop Helper

An experimental Chrome extension that previews numbers and automatically buys selected items and bundles from Glim's shop and items from the Black Market while an RNGidle tab is open. Glitch and Halloween shops are not supported.

> **Account risk:** RNGidle's [terms](https://rngidle.fun/terms) prohibit bots, scripts, auto-clickers, and tools that play for you. Automatic buying may violate those terms and could result in a progress reset or ban. Use only if you accept that risk.

## Install or update

1. Download the extension ZIP from the [Releases page](https://github.com/alexsasha2750/rngidle-extensions/releases) and extract it. Alternatively, clone or download this repository.
2. Open `chrome://extensions` in Chrome 120 or later and turn on **Developer mode**.
3. Choose **Load unpacked** and select the extracted `shop-helper` folder, which contains `manifest.json`. To update a previously unpacked copy, replace its files and click its **Reload** button in `chrome://extensions`.
4. Open and sign in to [RNGidle](https://rngidle.fun/). Keep a game tab open, but you can visit another page within the game.
5. Open the extension from Chrome's Extensions menu, choose your options, enable automatic purchases, and save.

The extension starts paused. It checks about once a minute while Chrome is running; it does not work after the game tab or Chrome is closed. A check is also triggered when a game tab opens or settings are saved. The game server remains responsible for purchases and can reject them.

## Number Checker

With an RNGidle tab open, enter a number in **Number Checker** and choose **Check number** to preview its badges and EP. For example, try `123`, `-12.5`, `3+4i`, `1+2i+3j+4k`, `∅`, or `NaN`. This uses the game's own live scoring engine in the game tab; it does not perform a roll or award EP. Results reflect that engine and can change if the game updates.

The checker uses the game's JavaScript in the page rather than redistributing it, so it requires the site to be loaded and is intended for unpacked installation, not Chrome Web Store publication under Manifest V3's remotely hosted code policy.

## Buying options

- **Glim's shop:** select any items or the bundle option. New selections default to the maximum quantity (up to 1,000 per shop); adjust it if you prefer. **Buy once** buys when possible and then stops for that item; **Every new shop restock** repeats each new shop. Use **Rearm once** to allow another one-time purchase. Actual purchases are limited by your EP, stock and the game's per-player limits.
- **Black Market:** opt in separately. You can limit purchases to the most expensive listed offer, selected items, or items whose listed price is at least your chosen EP amount. Turn on multiple checks to require **all** of them to match; with none enabled, any available and affordable offer can be purchased. The maximum-price check looks at the whole market, not just matching or affordable items. The game's Black Market may allow only one deal per visit.
- Both shops require the main automatic-purchases switch to be enabled. Purchases spend EP without an additional confirmation. Disable the switch and save to pause; a request already in flight may finish after pausing.
- Rules are tied to the first signed-in account used after enabling the extension. To switch accounts, pause it, clear its selections and disable Black Market buying, save, then sign in to the other account and configure it again.
- If a purchase response is lost, the extension keeps the same request ID when retrying. If the result cannot be established, inspect your inventory before re-enabling the affected selection.
- The item lists and displayed prices are snapshots. To reduce the chance of spending against stale prices, purchases stop if the site's shop catalog changes; the extension must then be updated before it can buy again.

Settings, status, and purchase activity are stored locally in the browser. The extension uses the game's existing signed-in session from its open tab and requests access only to `rngidle.fun`. It does not ask for or store credentials.

## Checks

Run `npm test` from the `shop-helper` folder with Node.js to exercise purchase planning and the background flow using simulated responses; no live purchases are made by these tests. Live signed-in purchases have not been verified by these tests.

## License and attribution

The original extension code is available under the [MIT License](LICENSE). The bundled item names and prices are a snapshot of the public RNGidle shop catalog; RNGidle and its game content belong to their respective owners. This project is not affiliated with RNGidle.
