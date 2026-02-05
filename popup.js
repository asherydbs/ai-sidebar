const toggle = document.getElementById('toggle');
const statusText = document.getElementById('status-text');
const titleText = document.getElementById('title-text');
const languageLabel = document.getElementById('language-label');
const languageSelect = document.getElementById('language-select');
const languageZh = document.getElementById('language-zh');
const languageEn = document.getElementById('language-en');

const translations = {
  zh: {
    title: 'AI 侧边栏',
    statusOn: '已开启',
    statusOff: '已关闭',
    languageLabel: '语言',
    languageZh: '中文',
    languageEn: '英文'
  },
  en: {
    title: 'AI Sidebar',
    statusOn: 'On',
    statusOff: 'Off',
    languageLabel: 'Language',
    languageZh: 'Chinese',
    languageEn: 'English'
  }
};

const state = { language: 'zh' };

const updateStatus = () => {
  const t = translations[state.language] || translations.zh;
  statusText.textContent = toggle.checked ? t.statusOn : t.statusOff;
};

const applyLanguage = (lang) => {
  state.language = translations[lang] ? lang : 'zh';
  const t = translations[state.language];
  titleText.textContent = t.title;
  languageLabel.textContent = t.languageLabel;
  languageZh.textContent = t.languageZh;
  languageEn.textContent = t.languageEn;
  updateStatus();
};

const sendMessageSafe = (message) => {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, message, () => {
      void chrome.runtime.lastError;
    });
  });
};

const notifyLanguage = (lang) => {
  sendMessageSafe({action: "setLanguage", language: lang});
};

toggle.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: toggle.checked });
  sendMessageSafe({action: "setEnabled", enabled: toggle.checked});
  updateStatus();
});

languageSelect.addEventListener('change', () => {
  const lang = languageSelect.value;
  chrome.storage.local.set({ language: lang });
  applyLanguage(lang);
  notifyLanguage(lang);
});

chrome.storage.local.get(['language', 'enabled'], (result) => {
  const lang = result.language || 'zh';
  const enabled = result.enabled !== undefined ? result.enabled : true;
  toggle.checked = enabled;
  languageSelect.value = lang;
  applyLanguage(lang);
  notifyLanguage(lang);
  sendMessageSafe({action: "setEnabled", enabled});
});
