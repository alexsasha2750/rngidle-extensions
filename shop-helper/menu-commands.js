// The keyboard shortcut that opens and closes the in-game menu (manifest command `toggle-menu`,
// Alt+Shift+H unless the player changed it). It flips the saved `uiOpen` switch; every open game
// tab follows it, even when the floating button is hidden.
export const TOGGLE_MENU = 'toggle-menu';

const registered = new WeakSet();

export async function toggleMenu(storage) {
  const { uiOpen } = await storage.get('uiOpen');
  const next = uiOpen !== true;
  await storage.set({ uiOpen: next });
  return next;
}

// Registers the command listener once per chrome object. Returns the listener (for tests), or
// null when this browser has no commands API.
export function registerMenuCommands({ storage, chrome: api = globalThis.chrome } = {}) {
  const onCommand = api?.commands?.onCommand;
  const store = storage ?? api?.storage?.local;
  if (!onCommand?.addListener || !store) return null;
  if (registered.has(onCommand)) return null;
  registered.add(onCommand);
  const listener = command => {
    if (command !== TOGGLE_MENU) return undefined;
    return toggleMenu(store).catch(() => null);
  };
  onCommand.addListener(listener);
  return listener;
}
