// When the extension icon is clicked, send a message to toggle the panel
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PANEL" });
});

