// content.js

class DOMScanner {
  constructor() {
    this.hostname = window.location.hostname;
    this.selectors = this.getSelectors();
  }

  getSelectors() {
    if (this.hostname.includes('chatgpt.com')) {
      return {
        // ChatGPT often uses data-message-author-role="user"
        // Update this based on latest DOM inspection if needed
        message: 'div[data-message-author-role="user"]',
        content: '.whitespace-pre-wrap'
      };
    } else if (this.hostname.includes('claude.ai')) {
      return {
        // Claude selectors - 适配最新 Claude.ai 界面
        message: '[data-testid="user-message"], .font-user-message, .user-message, [data-message-author-role="user"]',
        content: '.font-user-message, [data-testid="user-message"] > div, .user-message-content'
      };
    } else if (this.hostname.includes('chat.deepseek.com')) {
       return {
        // DeepSeek selectors (generic guess, need verification)
        message: '.ds-message-user', // Example
        content: '.ds-message-content'
      };
    } else if (this.hostname.includes('gemini.google.com')) {
      return {
        // Gemini selectors
        // Strategy: Look for containers that likely hold user messages
        message: '.user-query, .query-text, conversation-user-turn, user-message, [data-test-id="user-query"]', 
        content: 'div, span, p' // Generic content selector
      };
    }
    // Fallback generic
    return {
      message: '.user-message, .human-message',
      content: 'div'
    };
  }

  scan() {
    if (!this.selectors) return [];
    
    // If specific selectors fail, try to be smarter or fallback
    let elements = document.querySelectorAll(this.selectors.message);
    
    // Claude Fallback: Try alternative selectors if primary fails
    if (elements.length === 0 && this.hostname.includes('claude.ai')) {
      // Try to find user messages by looking for specific patterns
      elements = document.querySelectorAll('div[class*="user"], div[data-testid*="user"]');
      // Alternative: Look for message containers that don't have Claude's avatar
      if (elements.length === 0) {
        const allMessages = document.querySelectorAll('[data-testid="message"], .message');
        elements = Array.from(allMessages).filter(el => {
          // Filter out Claude's messages (they usually have specific attributes)
          const isClaude = el.querySelector('[data-testid="assistant-message"], .font-claude-message, img[alt*="Claude"]');
          return !isClaude;
        });
      }
    }

    // Gemini Fallback: Scan for Angular/Material structure if simple selectors fail
    if (elements.length === 0 && this.hostname.includes('gemini.google.com')) {
      // Look for elements with 'data-message-id' that are NOT model responses
      // Or look for specific aria-labels
      const allDivs = document.querySelectorAll('div[data-message-id]');
      const potentialItems = [];
      allDivs.forEach(div => {
         // Heuristic: User messages often don't have the model logo or specific model attributes
         // This is a weak heuristic, so we try to find text containers
         if (div.innerText.length > 0 && div.innerText.length < 500) { // arbitrary length check
             potentialItems.push(div);
         }
      });
      // Better heuristic for Gemini: Look for "user-query-text" or similar in classList
      elements = document.querySelectorAll('[class*="user-query"], [class*="UserQuery"]');
    }

    // ChatGPT fallback: sometimes structure is complex
    if (elements.length === 0 && this.hostname.includes('chatgpt.com')) {
        // Try finding all turns and filtering
        // This is a heuristic
        elements = document.querySelectorAll('div[data-testid^="conversation-turn-"]');
    }

    const items = [];
    elements.forEach((el, index) => {
      // Extract text
      let textEl = el.querySelector(this.selectors.content) || el;
      let text = textEl.innerText.trim();
      
      // If text is too long, truncate? Sidebar handles CSS truncation, but full text is good for search
      if (text) {
        items.push({
          id: `msg-${index}`,
          element: el,
          text: text,
          shortText: text.substring(0, 50) + (text.length > 50 ? '...' : '')
        });
      }
    });
    return items;
  }
}

const I18N = {
  zh: {
    title: '对话索引',
    searchPlaceholder: '搜索提示词...'
  },
  en: {
    title: 'Conversation Index',
    searchPlaceholder: 'Search prompts...'
  }
};

class SidebarUI {
  constructor(scanner) {
    this.scanner = scanner;
    this.items = [];
    this.filteredItems = [];
    this.bookmarks = new Set();
    this.isVisible = true;
    this.language = 'zh';
    this.i18n = I18N;
    this.enabled = true;
    this.host = null;
    this.hasMessageListener = false;
    
    this.shadowRoot = null;
    this.container = null;
    this.listContainer = null;
    this.titleEl = null;
    this.searchInput = null;
    this.resizeHandle = null;
    this.isResizing = false;
    this.sidebarWidth = 320;
    this.isCollapsed = false;
    
    this.init();
  }

  async init() {
    await this.loadBookmarks();
    const settings = await chrome.storage.local.get(['language', 'enabled', 'sidebarWidth', 'sidebarCollapsed']);
    this.language = settings.language || 'zh';
    this.enabled = settings.enabled !== undefined ? settings.enabled : true;
    this.sidebarWidth = settings.sidebarWidth || 320;
    this.isCollapsed = settings.sidebarCollapsed || false;
    this.registerMessageListener();
    if (!this.enabled) return;
    this.mount();
  }

  createTrigger() {
    // 不再创建悬浮按钮，使用 collapse-btn 代替
    this.triggerBtn = null;
  }

  registerMessageListener() {
    if (this.hasMessageListener) return;
    chrome.runtime.onMessage.addListener((request) => {
      if (request.action === "toggleSidebar") {
        this.setEnabled(!this.enabled);
      }
      if (request.action === "setEnabled") {
        this.setEnabled(!!request.enabled);
      }
      if (request.action === "setLanguage") {
        this.applyLanguage(request.language);
      }
    });
    this.hasMessageListener = true;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    chrome.storage.local.set({ enabled: this.enabled });
    if (this.enabled) {
      this.mount();
    } else {
      this.unmount();
    }
  }

  mount() {
    if (this.host) return;
    this.host = document.createElement('div');
    this.host.id = 'ai-sidebar-host';
    document.body.appendChild(this.host);

    this.shadowRoot = this.host.attachShadow({ mode: 'open' });

    const styleLink = document.createElement('link');
    styleLink.setAttribute('rel', 'stylesheet');
    styleLink.setAttribute('href', chrome.runtime.getURL('styles.css'));
    this.shadowRoot.appendChild(styleLink);

    this.container = document.createElement('div');
    this.container.id = 'ai-sidebar-container';
    this.container.style.width = `${this.sidebarWidth}px`;
    
    // Create resize handle
    this.resizeHandle = document.createElement('div');
    this.resizeHandle.className = 'resize-handle';
    this.container.appendChild(this.resizeHandle);
    
    // Create collapse button (positioned on the left, vertically centered)
    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'collapse-btn';
    collapseBtn.id = 'collapse-btn';
    collapseBtn.title = 'Collapse';
    collapseBtn.innerHTML = '▶';
    this.container.appendChild(collapseBtn);
    
    const header = document.createElement('div');
    header.className = 'header';
    header.innerHTML = `
      <div class="header-left">
        <span class="title"><span class="title-text"></span></span>
      </div>
    `;
    this.container.appendChild(header);

    const searchBox = document.createElement('div');
    searchBox.className = 'search-box';
    searchBox.innerHTML = `
      <input type="text" class="search-input" placeholder="">
    `;
    this.container.appendChild(searchBox);

    this.listContainer = document.createElement('div');
    this.listContainer.className = 'index-list';
    this.container.appendChild(this.listContainer);

    this.shadowRoot.appendChild(this.container);
    this.titleEl = header.querySelector('.title-text');
    this.searchInput = searchBox.querySelector('.search-input');
    this.applyLanguage(this.language);

    this.createTrigger();
    this.createTooltip();

    // Event listeners
    this.shadowRoot.getElementById('collapse-btn').addEventListener('click', () => this.toggleCollapse());
    this.searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
    
    // Resize functionality
    this.setupResizeHandlers();

    this.update();
    this.startObserver();
    this.startIntersectionObserver();
    
    // Apply collapsed state
    if (this.isCollapsed) {
      this.applyCollapseState();
    }
  }

  unmount() {
    if (this.domObserver) this.domObserver.disconnect();
    if (this.intersectionObserver) this.intersectionObserver.disconnect();
    if (this.visibleElements) this.visibleElements.clear();
    if (this.host && this.host.parentNode) this.host.parentNode.removeChild(this.host);
    this.host = null;
    this.shadowRoot = null;
    this.container = null;
    this.listContainer = null;
    this.titleEl = null;
    this.searchInput = null;
    this.triggerBtn = null;
    this.tooltip = null;
    this.resizeHandle = null;
    this.isResizing = false;
  }

  getText(key) {
    const dict = this.i18n[this.language] || this.i18n.zh;
    return dict[key] || '';
  }

  applyLanguage(lang) {
    this.language = this.i18n[lang] ? lang : 'zh';
    if (this.titleEl) this.titleEl.textContent = this.getText('title');
    if (this.searchInput) this.searchInput.placeholder = this.getText('searchPlaceholder');
  }

  createTooltip() {
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'custom-tooltip';
    // Append to shadowRoot so it's isolated but can be positioned fixed
    this.shadowRoot.appendChild(this.tooltip);
  }

  showTooltip(text, targetEl) {
    if (!this.tooltip) return;
    
    this.tooltip.textContent = text;
    this.tooltip.classList.add('visible');
    
    const rect = targetEl.getBoundingClientRect();
    
    // Position to the left of the sidebar
    // We assume the sidebar is on the right.
    // We want the tooltip to be to the left of the list item.
    // rect.left is the left edge of the item.
    // Let's place it 12px to the left of that.
    
    // Calculate right position relative to viewport right edge?
    // No, fixed positioning usually uses top/left or top/right.
    // Since sidebar is right-aligned, let's use `right`.
    // The item's right edge is at rect.right.
    // The item's left edge is at rect.left.
    // Window width - rect.left gives us the distance from the right edge to the item's left edge.
    // So if we set right = (window.innerWidth - rect.left) + 12, it starts 12px to the left of the item.
    
    const rightPos = (window.innerWidth - rect.left) + 12;
    
    // Vertical alignment: align with top of item
    let topPos = rect.top;
    
    // Boundary checks
    // If tooltip is too close to bottom, move it up
    // We can't easily know tooltip height before rendering, but we can guess or adjust.
    // Let's just set top/right for now.
    
    this.tooltip.style.right = `${rightPos}px`;
    this.tooltip.style.top = `${topPos}px`;
    
    // Optional: Adjust if it goes off-screen top (unlikely for sidebar items unless scrolled)
    if (topPos < 0) this.tooltip.style.top = '10px';
  }

  hideTooltip() {
    if (this.tooltip) {
      this.tooltip.classList.remove('visible');
    }
  }

  async loadBookmarks() {
    const key = `bookmarks-${window.location.href}`;
    const result = await chrome.storage.local.get(key);
    this.bookmarks = new Set(result[key] || []);
  }

  async saveBookmarks() {
    const key = `bookmarks-${window.location.href}`;
    await chrome.storage.local.set({ [key]: Array.from(this.bookmarks) });
  }

  update() {
    this.items = this.scanner.scan();
    this.filterAndRender();
    // Re-observe new elements
    this.updateIntersectionObserver();
  }

  handleSearch(query) {
    this.currentQuery = query.toLowerCase();
    this.filterAndRender();
  }

  filterAndRender() {
    const query = this.currentQuery || '';
    this.filteredItems = this.items.filter(item => 
      item.text.toLowerCase().includes(query)
    );
    this.renderList();
  }

  renderList() {
    this.listContainer.innerHTML = '';
    
    this.filteredItems.forEach(item => {
      const isBookmarked = this.bookmarks.has(item.text);
      
      const el = document.createElement('div');
      el.className = `index-item ${isBookmarked ? 'bookmarked' : ''}`;
      // Add data-id to link back to item
      el.dataset.itemId = item.id; 
      
      el.innerHTML = `
        <span class="item-text">${item.shortText}</span>
        <button class="bookmark-btn ${isBookmarked ? 'active' : ''}">★</button>
      `;
      
      const textEl = el.querySelector('.item-text');

      // Add tooltip listeners
      textEl.addEventListener('mouseenter', () => this.showTooltip(item.text, textEl));
      textEl.addEventListener('mouseleave', () => this.hideTooltip());
      
      textEl.addEventListener('click', () => {
        // Set manual scrolling flag to pause observer updates
        this.isManualScrolling = true;
        
        // Force highlight immediately
        this.highlightActiveItem(item.id);
        
        // Use scrollMarginTop to create an offset from the top
        // This prevents the text from sticking exactly to the viewport edge
        item.element.style.scrollMarginTop = '100px';
        item.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        
        // Highlight logic in page
        item.element.style.transition = 'background-color 0.5s';
        const originalBg = item.element.style.backgroundColor;
        item.element.style.backgroundColor = 'rgba(255, 255, 0, 0.3)';
        setTimeout(() => {
          item.element.style.backgroundColor = originalBg;
        }, 1000);
        
        // Reset manual scrolling flag after scroll animation
        if (this.scrollTimeout) clearTimeout(this.scrollTimeout);
        this.scrollTimeout = setTimeout(() => {
          this.isManualScrolling = false;
          // One final check to ensure correctness
          this.determineActiveItem();
        }, 1000);
      });

      el.querySelector('.bookmark-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleBookmark(item.text);
      });

      this.listContainer.appendChild(el);
    });
  }

  toggleBookmark(text) {
    if (this.bookmarks.has(text)) {
      this.bookmarks.delete(text);
    } else {
      this.bookmarks.add(text);
    }
    this.saveBookmarks();
    this.renderList();
  }

  startObserver() {
    let timeout;
    this.domObserver = new MutationObserver(() => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        this.update();
      }, 1000); // 1 sec debounce
    });
    
    this.domObserver.observe(document.body, { childList: true, subtree: true });
  }

  startIntersectionObserver() {
    this.visibleElements = new Set();

    this.intersectionObserver = new IntersectionObserver((entries) => {
      // Update tracking set
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          this.visibleElements.add(entry.target);
        } else {
          this.visibleElements.delete(entry.target);
        }
      });

      this.determineActiveItem();
    }, {
      root: null, // viewport
      threshold: [0.1, 0.5] // Trigger when 10% or 50% visible
    });
  }

  determineActiveItem() {
    if (this.visibleElements.size === 0 || this.isManualScrolling) return;

    // Strategy: 
    // We want the "current context" message.
    // If we are reading an answer, the context is the *previous* user message (above).
    // If we are reading a user message, that is the context.
    
    // Sort visible elements by position
    const sortedVisible = Array.from(this.visibleElements).sort((a, b) => {
        return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
    });
    
    // Default to the top-most visible element
    let activeEl = sortedVisible[0];
    
    // However, if the top-most visible element is barely visible at the bottom, 
    // maybe we shouldn't pick it? 
    // Actually, usually we want the one that is "active".
    
    // Let's look for the element that is closest to the TOP of the viewport (0), 
    // but not too far off screen.
    // Or, if an element has scrolled PAST the top, it might still be the active context 
    // until the NEXT one hits the top.
    
    // Revised Logic based on user request:
    // "如果提示词在滚动中向页面的下方移动时，当前高亮的应该是上一个提示词"
    // This implies we should highlight the LAST message that is ABOVE the viewport center 
    // or just ABOVE the bottom of the viewport?
    
    // Let's try this: Find the last message that is *above* a certain "reading line" (e.g., top 1/3 of screen).
    // If no message is visible, we might need to look at *all* items to find the one just above viewport.
    // But since we only track visibleElements via IntersectionObserver, we only know what's on screen.
    
    // If we only have visible elements:
    // The "active" one is usually the one at the top of the screen.
    // If I scroll UP, a previous message enters from top -> it becomes top-most visible -> it becomes active. Correct.
    // If I scroll DOWN, the top message leaves top -> the NEXT message becomes top-most visible -> it becomes active. Correct.
    
    // Wait, the user said: "如果提示词在滚动中向页面的下方移动时" (If a prompt moves DOWN towards the bottom of page)
    // -> This happens when I scroll UP.
    // "当前高亮的应该是上一个提示词" (The highlight should be the PREVIOUS prompt).
    // This implies if I see Prompt A and Answer A, and I scroll up to see Answer (A-1), 
    // Prompt A moves down. The highlight should switch to Prompt (A-1).
    
    // This aligns with "Top-most visible prompt is active".
    // If Prompt A moves down, it means I am viewing what is ABOVE it. 
    // If Prompt (A-1) enters from top, it becomes the new top-most visible.
    
    // So "Top-most visible" seems to cover this?
    // Let's refine "Top-most visible".
    
    if (sortedVisible.length > 0) {
        // We pick the first one (top-most physically in the document flow among visible ones)
        activeEl = sortedVisible[0];
        
        // Edge case: What if multiple are visible?
        // e.g. [Prompt A] ... [Prompt B]
        // Both visible. User is likely reading Prompt A's answer or Prompt B.
        // If B is at the bottom and A is at top, active is A.
        // If A scrolls off top, B becomes top-most visible -> active is B.
        
        // This seems to match standard TOC behavior.
        
        const matchedItem = this.items.find(item => item.element === activeEl);
        if (matchedItem) {
          this.highlightActiveItem(matchedItem.id);
        }
    }
  }

  updateIntersectionObserver() {
    // Disconnect old
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }
    if (this.visibleElements) {
      this.visibleElements.clear();
    }
    
    // Observe all current item elements
    this.items.forEach(item => {
      if (item.element) {
        this.intersectionObserver.observe(item.element);
      }
    });
  }

  highlightActiveItem(id) {
    // Remove active class from all
    const allItems = this.listContainer.querySelectorAll('.index-item');
    allItems.forEach(el => el.classList.remove('active'));
    
    // Add to current
    const activeEl = this.listContainer.querySelector(`.index-item[data-item-id="${id}"]`);
    if (activeEl) {
      activeEl.classList.add('active');
      // Optional: Auto-scroll sidebar to keep active item in view
      // activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  setupResizeHandlers() {
    if (!this.resizeHandle) return;
    
    const startResize = (e) => {
      this.isResizing = true;
      this.resizeHandle.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      
      const startX = e.clientX || e.touches[0].clientX;
      const startWidth = this.container.offsetWidth;
      
      const doResize = (e) => {
        if (!this.isResizing) return;
        const currentX = e.clientX || (e.touches && e.touches[0].clientX);
        const diff = startX - currentX;
        const newWidth = Math.max(240, Math.min(600, startWidth + diff));
        
        this.container.style.width = `${newWidth}px`;
        this.sidebarWidth = newWidth;
      };
      
      const stopResize = () => {
        if (!this.isResizing) return;
        this.isResizing = false;
        this.resizeHandle.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        
        // Save width to storage
        chrome.storage.local.set({ sidebarWidth: this.sidebarWidth });
        
        document.removeEventListener('mousemove', doResize);
        document.removeEventListener('mouseup', stopResize);
        document.removeEventListener('touchmove', doResize);
        document.removeEventListener('touchend', stopResize);
      };
      
      document.addEventListener('mousemove', doResize);
      document.addEventListener('mouseup', stopResize);
      document.addEventListener('touchmove', doResize);
      document.addEventListener('touchend', stopResize);
    };
    
    this.resizeHandle.addEventListener('mousedown', startResize);
    this.resizeHandle.addEventListener('touchstart', startResize);
  }

  toggleCollapse() {
    this.isCollapsed = !this.isCollapsed;
    chrome.storage.local.set({ sidebarCollapsed: this.isCollapsed });
    this.applyCollapseState();
  }

  applyCollapseState() {
    if (!this.container) return;
    
    if (this.isCollapsed) {
      this.container.classList.add('collapsed');
      // Update collapse button icon (collapsed state: show left arrow to indicate expand direction)
      const collapseBtn = this.shadowRoot.getElementById('collapse-btn');
      if (collapseBtn) collapseBtn.innerHTML = '◀';
    } else {
      this.container.classList.remove('collapsed');
      // Update collapse button icon (expanded state: show right arrow to indicate collapse direction)
      const collapseBtn = this.shadowRoot.getElementById('collapse-btn');
      if (collapseBtn) collapseBtn.innerHTML = '▶';
    }
  }
}


// Initialize
const scanner = new DOMScanner();
const sidebar = new SidebarUI(scanner);
