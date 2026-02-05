// background.js
console.log("AI Sidebar Extension Background Service Worker Loaded");

chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed");
});
