# RNGidle Shop Helper

An experimental Chrome extension for [RNGidle](https://rngidle.fun/) with three tools in one menu:

- **Auto-buy** automatically buys selected items and bundles from Glim's shop, and items from the Black Market, while an RNGidle tab is open.
- **Glitch** shows Glitch's shelf, lets you pick what to try for, presents his timed trial questions for you to answer, and buys the ware once the game confirms you passed. It also can alert you when he visits.
- **Number checker** previews the badges and EP a number would earn, without rolling.

The menu opens from the toolbar icon **and** inside the game itself, so it stays open while you play. The Halloween shop is not supported.

> **Account risk:** RNGidle's [terms](https://rngidle.fun/terms) prohibit bots, scripts, auto-clickers, and tools that play for you. Automatic buying may violate those terms and could result in a progress reset or ban. Use only if you accept that risk.

## Install or update

1. Download the extension ZIP from the [Releases page](https://github.com/alexsasha2750/rngidle-extensions/releases) and extract it. Alternatively, clone or download this repository.
2. Open `chrome://extensions` in Chrome 120 or later and turn on **Developer mode**.
3. Choose **Load unpacked** and select the extracted `shop-helper` folder, which contains `manifest.json`. To update a previously unpacked copy, replace its files and click its **Reload** button in `chrome://extensions`, then **refresh any open RNGidle tabs** so the in-game menu updates too.
4. Open [RNGidle](https://rngidle.fun/). A round button appears in the bottom-right corner; click it, or use the toolbar icon, to open the menu.

The current version is shown at the top of the menu.

## The menu

The menu has three tabs. Your last tab, and whether the in-game menu is open, are remembered.

- **Auto-buy** has a main **Automatic purchases** switch with connection status, then two sections: **Glim's shop** and **Black Market**. Changes apply when you choose **Save settings**.
- **Glitch** shows his shelf and visit timer, with an optional alert and a trial you answer yourself (see below).
- **Number checker** previews a number; tap an example to try it.

### In-game menu

- The floating button opens and closes the menu. A small dot on it shows auto-buy status: green is running, amber is waiting (for example, no game tab or not signed in), red is an error, and no dot means paused.
- Hide the menu with the **▾** button in its header, by pressing **Esc**, or by clicking the floating button again. It stays hidden until you open it.
- To remove the floating button completely, turn off **In-game button** at the bottom of the menu. Reopen the menu from the toolbar icon, where you can turn the button back on.
- The menu opens in a panel that fits phones and small windows, and animations respect your system's reduced-motion setting.

## Auto-buy

The extension starts paused. It checks about once a minute while Chrome is running; it does not work after the game tab or Chrome is closed. A check is also triggered when a game tab opens or settings are saved. The game server remains responsible for purchases and can reject them.

- **Glim's shop:** select any items or **Any bundle**. New selections default to the maximum quantity (up to 1,000 per shop); adjust it if you prefer. **Buy once** buys when possible and then stops for that item; **Every new shop restock** repeats each new shop. Use **Rearm once** to allow another one-time purchase. Actual purchases are limited by your EP, stock and the game's per-player limits.
- **Black Market:** opt in separately. You can limit purchases to the most expensive listed offer, selected items, or items whose listed price is at least your chosen EP amount. Enabled filters all have to match; with none enabled, any available and affordable offer can be purchased. The "most expensive" check looks at the whole market, not just matching or affordable items. The game's Black Market may allow only one deal per visit.
- Both shops need the main **Automatic purchases** switch to be on. Purchases spend EP without an additional confirmation. Turn the switch off and save to pause; a request already in flight may finish after pausing.
- Rules are tied to the first signed-in account used after enabling the extension. To switch accounts, pause it, clear its selections, turn off Black Market buying, save, then sign in to the other account and configure it again.
- If a purchase response is lost, the extension keeps the same request ID when retrying. If the result cannot be established, inspect your inventory before re-enabling the affected selection.
- The item lists and displayed prices are snapshots. To reduce the chance of spending against stale prices, purchases stop if the site's shop catalog changes; the extension must then be updated before it can buy again.

Settings, status, and purchase activity are stored locally in the browser. The extension uses the game's existing signed-in session from its open tab and requests access only to `rngidle.fun`. It does not ask for or store credentials.

## Glitch

Glitch quizzes you before every purchase, and the game's server checks the answers against a time limit. The extension does **not** answer for you: it shows each question, you pick or type the answer, and it sends that to the game. Only when the game reports that you passed does the extension send the purchase.

- Open the **Glitch** tab (with an RNGidle tab open and signed in) to see his shelf. Wares show as available, sold out, already bought, too expensive, or not on his shelf. Tick the wares you want, then choose **Take the trial**; with several ticked, each gets its own trial in turn.
- A wrong or late answer ends that trial and shows the correct answer. Glitch makes you rest briefly before you can try again; you can also skip a ware or stop the queue.
- Keep the menu open during a trial. Closing it mid-way abandons the trial; a trial you already passed is bought straight away.
- **Alert me when Glitch visits** (off by default) puts a badge on the toolbar icon and a pulsing ring and prompt on the in-game button when a ware you ticked (or any buyable ware, if none are ticked) is on his shelf. It checks about every 30 seconds while Chrome is running and an RNGidle tab is open.
- If a purchase reply is lost, the extension retries with the same request ID so you are not charged twice. If the outcome stays unknown, it stops the queue and tells you to check your inventory.
- The extension refuses to start a trial when you are signed out, when a different account than the one set up for auto-buy is signed in, or when the game's own button would be disabled (away, sold out, bought, or too expensive).

## Number checker

With an RNGidle tab open, enter a number and choose **Check** to preview its badges and EP. For example, try `123`, `-12.5`, `3+4i`, `1+2i+3j+4k`, `∅`, or `NaN` (up to 250 characters). This uses the game's own live scoring engine in the game tab; it does not perform a roll or award EP. Results reflect that engine and can change if the game updates.

The checker uses the game's JavaScript in the page rather than redistributing it, so it requires the site to be loaded and is intended for unpacked installation, not Chrome Web Store publication under Manifest V3's remotely hosted code policy.

## Checks

Run `npm test` from the `shop-helper` folder with Node.js to exercise purchase planning, the Glitch trial and purchase flow, the background flow, and the extension package using simulated responses; no live purchases are made by these tests. Live signed-in purchases have not been verified by these tests, and the Glitch flow has so far only been exercised against a simulated game server.

## License and attribution

The original extension code is available under the [MIT License](LICENSE). The bundled item names and prices are a snapshot of the public RNGidle shop catalog; RNGidle and its game content belong to their respective owners. This project is not affiliated with RNGidle.
