(() => {
  /* ============================================================
     SCRAPING LOGIC
     ============================================================ */
  const EMAIL_REGEX = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;

  function isChannelPage(url) {
    try {
      const u = new URL(url);
      if (u.hostname !== "www.youtube.com") return false;
      const p = u.pathname;
      return p.startsWith("/@") || p.startsWith("/channel/") || p.startsWith("/c/") || p.startsWith("/user/");
    } catch { return false; }
  }

  function tryExpandDescription() {
    // 1. Expand any "Show more" / "more" buttons already visible
    const expandSels = [
      'tp-yt-paper-button#more', '#description-container .more-button',
      'ytd-text-inline-expander #expand', '[aria-label="Show more"]',
      'ytd-channel-tagline-renderer .more-button', '#page-header tp-yt-paper-button',
    ];
    for (const s of expandSels) document.querySelectorAll(s).forEach(b => { try { b.click(); } catch {} });

    // 2. Try to open the About popup by clicking the channel description/tagline snippet
    //    YouTube shows a short tagline on the channel header; clicking it opens the full About dialog.
    const aboutTriggers = [
      'ytd-channel-tagline-renderer #channel-tagline',          // tagline text
      'ytd-channel-tagline-renderer',                            // tagline container
      '#page-header yt-description-preview-view-model',          // newer layout description preview
      '#page-header .page-header-view-model-wiz__page-header-headline-info .yt-content-metadata-view-model-wiz__metadata-row', // metadata row
      'yt-description-preview-view-model',                       // description preview
      '#channel-header-container .channel-tagline',              // older layout
    ];
    for (const s of aboutTriggers) {
      const el = document.querySelector(s);
      if (el) { try { el.click(); } catch {} break; }
    }
  }

  // Collect emails from ONLY safe, non-stale sources (meta tags, header).
  // Does NOT touch about popup elements — those are handled separately via diff.
  function getHeaderText() {
    const parts = [];

    // Meta tags (these update reliably on SPA navigation)
    ["meta[property='og:description']","meta[name='description']"]
      .forEach(s => { const e = document.querySelector(s); if (e && e.content) parts.push(e.content); });

    // Channel header area only (NOT the full page which may contain stale popups)
    const headerSels = [
      '#channel-header',
      '#page-header',
      'ytd-c4-tabbed-header-renderer',
    ];
    for (const sel of headerSels) {
      const el = document.querySelector(sel);
      if (el && el.innerText) { parts.push(el.innerText); break; }
    }

    return parts.join('\n');
  }

  // Snapshot all emails currently visible anywhere in the DOM.
  // Used to diff before/after opening the about popup.
  function snapshotAllEmails() {
    const text = document.body.innerText || '';
    const m = text.match(EMAIL_REGEX) || [];
    // Also grab mailto: links
    document.querySelectorAll('a[href^="mailto:"]').forEach(a => {
      const em = a.href.replace('mailto:','').split('?')[0]; if (em) m.push(em);
    });
    return new Set(m.map(e => e.trim().toLowerCase()));
  }

  function extractEmails(text) {
    const m = text.match(EMAIL_REGEX) || [];
    const u = new Set(m.map(e => e.trim().toLowerCase()).filter(e => !e.endsWith('.png') && !e.endsWith('.jpg') && !e.endsWith('.svg')));
    return Array.from(u);
  }

  function extractChannelName() {
    for (const s of ['ytd-channel-name yt-formatted-string#text','ytd-channel-name #text',
      'ytd-channel-name yt-formatted-string','#channel-header-container ytd-channel-name yt-formatted-string',
      '#page-header yt-dynamic-text-view-model span']) {
      const e = document.querySelector(s);
      if (e && e.textContent && e.textContent.trim()) return e.textContent.trim();
    }
    const meta = document.querySelector("meta[property='og:title']");
    return meta && meta.content ? meta.content.trim() : "";
  }

  function getChannelUrl() {
    const raw = window.location.href.split('?')[0].split('#')[0];
    const m = raw.match(/(https:\/\/www\.youtube\.com\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+))/);
    return m ? m[1] : raw;
  }

  function closeAboutPopup() {
    // Close the about popup if it was opened by our scan
    const closeBtns = [
      'ytd-about-channel-renderer #close-button button',
      'ytd-about-channel-renderer tp-yt-paper-icon-button',
      'tp-yt-paper-dialog .close-button',
      'yt-about-channel-view-model button[aria-label="Close"]',
      'tp-yt-paper-dialog #close-button',
    ];
    for (const s of closeBtns) {
      const btn = document.querySelector(s);
      if (btn) { try { btn.click(); } catch {} return; }
    }
    // Fallback: press Escape to close any open dialog
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  }

  async function scrape() {
    if (!isChannelPage(window.location.href))
      return { ok: false, error: "Not on a channel page." };

    // Capture URL before we start — YouTube SPA may still be loading
    const urlBefore = getChannelUrl();

    // Step 0: Close any stale about popup left over from a previous channel
    closeAboutPopup();
    await new Promise(r => setTimeout(r, 400));

    // Step 1: Collect emails from SAFE sources (meta tags, channel header only)
    const headerEmails = extractEmails(getHeaderText());

    // Step 2: Snapshot all emails currently in the DOM BEFORE opening the about popup.
    //         This captures any stale emails from previous channels' leftover renderers.
    const emailsBefore = snapshotAllEmails();

    // Step 3: Open the about popup for THIS channel
    tryExpandDescription();
    await new Promise(r => setTimeout(r, 1200));

    // Step 4: Snapshot all emails AFTER the popup opened.
    //         New emails = emails that appeared ONLY after we opened the popup.
    const emailsAfter = snapshotAllEmails();
    const freshPopupEmails = [];
    for (const em of emailsAfter) {
      if (!emailsBefore.has(em)) freshPopupEmails.push(em);
    }

    // Step 5: Close the about popup
    closeAboutPopup();

    // Combine: safe header emails + only the FRESH emails from the popup
    const allEmails = new Set([...headerEmails, ...freshPopupEmails]);
    // Filter out image-like false positives
    const filtered = Array.from(allEmails).filter(e => !e.endsWith('.png') && !e.endsWith('.jpg') && !e.endsWith('.svg'));

    // Verify we're still on the same page
    const urlAfter = getChannelUrl();
    if (urlBefore !== urlAfter)
      return { ok: false, error: "Page changed during scan. Try again." };

    return { ok: true, channelUrl: urlAfter, channelName: extractChannelName(), emails: filtered };
  }

  /* ============================================================
     FLOATING PANEL — HTML
     ============================================================ */
  const PANEL_ID = "yt-scraper-panel";

  function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

  function buildPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div id="yts-header">
        <span id="yts-title">YT Email Scraper</span>
        <div id="yts-header-btns">
          <button id="yts-min" title="Minimize">&#8211;</button>
          <button id="yts-close" title="Close">&times;</button>
        </div>
      </div>
      <div id="yts-body">
        <button id="yts-scan">Scan This Channel</button>
        <div id="yts-status"></div>
        <div id="yts-result" class="yts-hidden">
          <div class="yts-field"><span class="yts-lbl">NAME</span><span id="yts-name" class="yts-val">-</span></div>
          <div class="yts-field"><span class="yts-lbl">LINK</span><span id="yts-link" class="yts-val yts-link-val">-</span></div>
          <div class="yts-field"><span class="yts-lbl">EMAIL</span><span id="yts-email" class="yts-val">-</span></div>
        </div>
        <div id="yts-list-section">
          <div id="yts-list-header">
            <span>Collected (<span id="yts-count">0</span>)</span>
            <div id="yts-list-btns">
              <button id="yts-export">CSV</button>
              <button id="yts-copy-list">Copy</button>
              <button id="yts-clear">Clear</button>
            </div>
          </div>
          <div id="yts-list"></div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    injectStyles();
    wireEvents();
    loadList();
  }

  /* ============================================================
     FLOATING PANEL — CSS
     ============================================================ */
  function injectStyles() {
    if (document.getElementById("yts-styles")) return;
    const style = document.createElement("style");
    style.id = "yts-styles";
    style.textContent = `
      #yt-scraper-panel { position:fixed; top:80px; right:20px; width:360px; z-index:999999;
        background:#15151b; border:1px solid #2b2b33; border-radius:12px; font-family:'Segoe UI',sans-serif;
        color:#f5f5f5; box-shadow:0 8px 32px rgba(0,0,0,.5); overflow:hidden; }
      #yts-header { display:flex; justify-content:space-between; align-items:center; padding:10px 14px;
        background:#1a1a24; cursor:grab; user-select:none; }
      #yts-header:active { cursor:grabbing; }
      #yts-title { font-size:13px; font-weight:600; }
      #yts-header-btns { display:flex; gap:4px; }
      #yts-header-btns button { background:none; border:0; color:#888; font-size:16px; cursor:pointer;
        width:24px; height:24px; border-radius:4px; display:flex; align-items:center; justify-content:center; }
      #yts-header-btns button:hover { background:#2a2a35; color:#fff; }
      #yts-body { padding:12px 14px; }
      #yts-scan { width:100%; border:0; padding:9px; border-radius:8px; background:#ff0033; color:#fff;
        font-weight:600; font-size:13px; cursor:pointer; }
      #yts-scan:hover { background:#ff1a4a; }
      #yts-status { font-size:11px; color:#a0a0a0; margin-top:6px; min-height:14px; }
      .yts-hidden { display:none !important; }
      #yts-result { margin-top:8px; border-top:1px solid #2b2b33; padding-top:8px; }
      .yts-field { display:flex; gap:8px; font-size:12px; margin-bottom:6px; align-items:baseline; }
      .yts-lbl { min-width:40px; color:#888; font-size:10px; letter-spacing:.5px; flex-shrink:0; }
      .yts-val { color:#eee; word-break:break-all; }
      .yts-link-val { color:#4fc3f7; font-size:11px; }
      #yts-list-section { margin-top:10px; border-top:1px solid #2b2b33; padding-top:8px; }
      #yts-list-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; font-size:12px; color:#ccc; }
      #yts-list-btns { display:flex; gap:4px; }
      #yts-list-btns button { border:0; padding:3px 7px; border-radius:4px; background:#2a2a35; color:#ccc;
        font-size:10px; cursor:pointer; }
      #yts-list-btns button:hover { background:#3a3a48; }
      #yts-list { max-height:180px; overflow-y:auto; }
      .yts-row { display:flex; align-items:center; gap:5px; padding:3px 0; border-bottom:1px solid #1e1e26; font-size:11px; }
      .yts-row-num { color:#555; min-width:16px; text-align:right; flex-shrink:0; }
      .yts-row-name { color:#eee; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .yts-row-email { color:#4fc3f7; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-align:right; }
      .yts-row-email.none { color:#555; }
      .yts-row-del { background:none; border:0; color:#555; font-size:13px; cursor:pointer; padding:0 2px; flex-shrink:0; }
      .yts-row-del:hover { color:#ff4444; }
      .yts-empty { font-size:11px; color:#555; text-align:center; padding:6px 0; }
      #yt-scraper-panel.yts-minimized #yts-body { display:none; }
    `;
    document.head.appendChild(style);
  }

  /* ============================================================
     PANEL LOGIC — drag, scan, list, export
     ============================================================ */
  let collectedList = [];

  async function loadList() {
    const data = await chrome.storage.local.get("ytScrapeList");
    collectedList = data.ytScrapeList || [];
    renderList();
  }
  async function saveList() { await chrome.storage.local.set({ ytScrapeList: collectedList }); }

  function addToList(entry) {
    const idx = collectedList.findIndex(e => e.link === entry.link);
    if (idx >= 0) collectedList[idx] = entry; else collectedList.push(entry);
    saveList(); renderList();
  }

  function renderList() {
    const countEl = document.getElementById("yts-count");
    const listEl = document.getElementById("yts-list");
    if (!countEl || !listEl) return;
    countEl.textContent = collectedList.length;
    listEl.innerHTML = "";
    if (!collectedList.length) { listEl.innerHTML = '<div class="yts-empty">No channels yet</div>'; return; }
    collectedList.forEach((item, i) => {
      const hasEmail = item.email && item.email !== "";
      const row = document.createElement("div"); row.className = "yts-row";
      row.innerHTML = `<span class="yts-row-num">${i+1}</span><span class="yts-row-name">${esc(item.name)}</span><span class="yts-row-email ${hasEmail?"":"none"}">${hasEmail?esc(item.email):"-"}</span><button class="yts-row-del" data-idx="${i}">&times;</button>`;
      listEl.appendChild(row);
    });
    listEl.querySelectorAll(".yts-row-del").forEach(b => b.addEventListener("click", e => {
      collectedList.splice(parseInt(e.target.dataset.idx), 1); saveList(); renderList();
    }));
  }

  function setStatus(txt, err) {
    const el = document.getElementById("yts-status"); if (!el) return;
    el.textContent = txt; el.style.color = err ? "#ff4444" : "#a0a0a0";
  }

  function wireEvents() {
    const panel = document.getElementById(PANEL_ID);
    // Drag
    const header = document.getElementById("yts-header");
    let dragging = false, dx = 0, dy = 0;
    header.addEventListener("mousedown", e => {
      if (e.target.tagName === "BUTTON") return;
      dragging = true; dx = e.clientX - panel.offsetLeft; dy = e.clientY - panel.offsetTop;
    });
    document.addEventListener("mousemove", e => { if (!dragging) return; panel.style.left = (e.clientX-dx)+"px"; panel.style.top = (e.clientY-dy)+"px"; panel.style.right = "auto"; });
    document.addEventListener("mouseup", () => { dragging = false; });

    // Close / Minimize
    document.getElementById("yts-close").addEventListener("click", () => panel.remove());
    document.getElementById("yts-min").addEventListener("click", () => panel.classList.toggle("yts-minimized"));

    // Scan
    document.getElementById("yts-scan").addEventListener("click", async () => {
      setStatus("Scanning...");
      document.getElementById("yts-result").classList.add("yts-hidden");
      const res = await scrape();
      if (!res.ok) { setStatus(res.error, true); return; }
      const name = res.channelName || "-";
      const link = res.channelUrl || "-";
      const emails = res.emails || [];
      const emailStr = emails.length ? emails.join(", ") : "No email found";
      document.getElementById("yts-name").textContent = name;
      document.getElementById("yts-link").textContent = link;
      const emailEl = document.getElementById("yts-email");
      emailEl.textContent = emailStr; emailEl.style.color = emails.length ? "#4fc3f7" : "#888";
      document.getElementById("yts-result").classList.remove("yts-hidden");
      setStatus("Done. Added to list.");
      addToList({ name, link, email: emails.join(", ") });
    });

    // Copy list
    document.getElementById("yts-copy-list").addEventListener("click", () => {
      if (!collectedList.length) return;
      const tsv = "Name\tLink\tEmail\n" + collectedList.map(e => `${e.name}\t${e.link}\t${e.email}`).join("\n");
      navigator.clipboard.writeText(tsv).then(() => setStatus("List copied!"));
    });

    // Export CSV
    document.getElementById("yts-export").addEventListener("click", () => {
      if (!collectedList.length) return;
      const ce = s => `"${(s||"").replace(/"/g,'""')}"`;
      const csv = "Name,Link,Email\n" + collectedList.map(e => `${ce(e.name)},${ce(e.link)},${ce(e.email)}`).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "yt_emails.csv"; a.click();
      setStatus("CSV exported!");
    });

    // Clear
    document.getElementById("yts-clear").addEventListener("click", () => {
      if (!collectedList.length) return;
      collectedList = []; saveList(); renderList(); setStatus("List cleared.");
    });
  }


  /* ============================================================
     MESSAGE LISTENER & INIT
     ============================================================ */
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "TOGGLE_PANEL") {
      const panel = document.getElementById(PANEL_ID);
      if (panel) {
        panel.remove();
      } else {
        buildPanel();
      }
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });
})();