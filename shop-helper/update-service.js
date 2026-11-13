// Looking for a newer release and downloading it. This is a placeholder until the real service
// replaces it; background.js already calls it, so the contract is fixed:
//   handle(message)  → a Promise for the reply when the message is an update message, else null
//   onSiteReady()    → a Promise; called when a game tab opens (the automatic check, if turned on)
export function createUpdateService() {
  return {
    handle() { return null; },
    async onSiteReady() {},
  };
}
