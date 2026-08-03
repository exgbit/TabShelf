(function () {
  'use strict';

  const DEFAULT_ORG = '个人';

  // 元素
  const orgListEl = document.getElementById('orgList');
  const orgNameEl = document.getElementById('orgName');
  const searchInput = document.getElementById('search');
  const myCollectionsBtn = document.getElementById('myCollections');
  const starredBtn = document.getElementById('starredBtn');
  const spaceListEl = document.getElementById('spaceList');
  const addSpaceBtn = document.getElementById('addSpaceBtn');
  const spaceTitleEl = document.getElementById('spaceTitle');
  const colCountEl = document.getElementById('colCount');
  const expandAllBtn = document.getElementById('expandAll');
  const collapseAllBtn = document.getElementById('collapseAll');
  const addCollectionBtn = document.getElementById('addCollectionBtn');
  const railAddBtn = document.getElementById('railAdd');
  const sectionsEl = document.getElementById('sections');
  const emptyEl = document.getElementById('empty');
  const noResultsEl = document.getElementById('noResults');
  const searchOpenWrap = document.getElementById('searchOpenWrap');
  const openResultsEl = document.getElementById('openResults');
  const windowListEl = document.getElementById('windowList');
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');

  // 状态
  let collections = [];
  let selectedOrg = null;    // null = 全部组织
  let selectedSpace = null;  // null = 全部空间
  let showStarred = false;   // true = 只看星标收藏集
  const collapsedIds = new Set();

  const orgKey = c => c.org || '';
  const orgDisplay = raw => raw || DEFAULT_ORG;
  const spaceOf = c => c.space || '';

  /* ---------- 工具 ---------- */

  function faviconUrl(pageUrl) {
    const u = new URL(chrome.runtime.getURL('/_favicon/'));
    u.searchParams.set('pageUrl', pageUrl);
    u.searchParams.set('size', '32');
    return u.toString();
  }

  function faviconImg(url, title) {
    const img = document.createElement('img');
    img.src = faviconUrl(url);
    img.alt = '';
    img.addEventListener('error', () => {
      const div = document.createElement('div');
      div.className = 'letter-icon';
      div.textContent = (title || url || '?').trim().charAt(0).toUpperCase();
      img.replaceWith(div);
    }, { once: true });
    return img;
  }

  function shortUrl(url) {
    return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /** 组织头像颜色：按名字哈希取色 */
  function orgColor(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `hsl(${h}, 55%, 45%)`;
  }

  function visibleCollections() {
    const visible = collections.filter(c =>
      (selectedOrg === null || orgKey(c) === selectedOrg) &&
      (showStarred ? !!c.starred
                   : (selectedSpace === null || spaceOf(c) === selectedSpace)));
    // 星标收藏集置顶
    return visible.sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0));
  }

  /* ---------- 左一：组织栏 ---------- */

  function renderRail() {
    orgListEl.textContent = '';

    const allBtn = el('div', 'org-avatar' + (selectedOrg === null ? ' active' : ''), '全');
    allBtn.title = '全部组织';
    allBtn.style.background = '#2c303a';
    allBtn.addEventListener('click', () => {
      selectedOrg = null;
      selectedSpace = null;
      showStarred = false;
      render();
    });
    orgListEl.appendChild(allBtn);

    const orgs = [...new Set(collections.map(orgKey))];
    for (const org of orgs) {
      const label = orgDisplay(org);
      const avatar = el('div', 'org-avatar' + (selectedOrg === org ? ' active' : ''));
      avatar.textContent = label.slice(0, 2);
      avatar.title = label;
      avatar.style.background = orgColor(label);
      avatar.addEventListener('click', () => {
        selectedOrg = selectedOrg === org ? null : org;
        selectedSpace = null;
        showStarred = false;
        render();
      });
      orgListEl.appendChild(avatar);
    }
  }

  /* ---------- 左二：空间面板 ---------- */

  function renderSpaces() {
    orgNameEl.textContent = selectedOrg === null ? '全部收藏集' : orgDisplay(selectedOrg);

    const inOrg = collections.filter(c => selectedOrg === null || orgKey(c) === selectedOrg);

    myCollectionsBtn.classList.toggle('active', !showStarred && selectedSpace === null);
    myCollectionsBtn.innerHTML = '';
    myCollectionsBtn.append('全部收藏集', el('span', 'count', String(inOrg.length)));

    const starredCount = inOrg.filter(c => c.starred).length;
    starredBtn.classList.toggle('active', showStarred);
    starredBtn.innerHTML = '';
    starredBtn.append('星标收藏集', el('span', 'count', String(starredCount)));

    spaceListEl.textContent = '';
    const spaceNames = [...new Set(inOrg.map(spaceOf))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    for (const space of spaceNames) {
      const count = inOrg.filter(c => spaceOf(c) === space).length;
      const item = el('button', 'nav-item' + (!showStarred && selectedSpace === space ? ' active' : ''));
      item.append(space, el('span', 'count', String(count)));
      item.addEventListener('click', () => {
        showStarred = false;
        selectedSpace = selectedSpace === space ? null : space;
        render();
      });
      spaceListEl.appendChild(item);
    }
  }

  /* ---------- 收藏集头部：图标按钮与菜单 ---------- */

  function iconBtn(text, tip, onClick) {
    const b = el('button', 'icon-btn', text);
    b.dataset.tip = tip;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(e, b);
    });
    return b;
  }

  let openMenu = null;
  function closeMenu() {
    if (openMenu) {
      openMenu.remove();
      openMenu = null;
    }
  }
  document.addEventListener('click', closeMenu);

  function toggleColMenu(col, headerEl) {
    if (openMenu) {
      closeMenu();
      return;
    }
    const menu = el('div', 'col-menu');
    const items = [
      ['重命名', async () => {
        const name = prompt('收藏集名称', col.name);
        if (name && name.trim()) {
          await Store.renameCollection(col.id, name.trim());
          await load();
        }
      }],
      ['移动到空间', async () => {
        const space = prompt('目标空间名称（留空 = 全部收藏集）', col.space || '');
        if (space === null) return;
        await Store.updateCollection(col.id, { space: space.trim() });
        await load();
      }],
      ['删除收藏集', async () => {
        if (confirm(`删除收藏集「${col.name}」(${col.tabs.length} 个标签)？`)) {
          await Store.deleteCollection(col.id);
          await load();
        }
      }]
    ];
    for (const [label, fn] of items) {
      const item = el('button', 'menu-item', label);
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeMenu();
        await fn();
      });
      menu.appendChild(item);
    }
    headerEl.appendChild(menu);
    openMenu = menu;
  }

  /* ---------- 中间：收藏集 ---------- */

  function bookmarkCard(tab, options = {}) {
    const card = el('a', 'bookmark-card');
    card.href = tab.url;
    card.target = '_blank';
    card.rel = 'noopener';
    card.appendChild(faviconImg(tab.url, tab.title));
    const text = el('div', 'bc-text');
    text.appendChild(el('div', 'bc-title', tab.title || tab.url));
    text.appendChild(el('div', 'bc-url', shortUrl(tab.url)));
    card.appendChild(text);
    card.title = tab.url;

    if (options.onRemove) {
      const btn = el('button', 'remove', '×');
      btn.title = '从收藏集移除';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        options.onRemove();
      });
      card.appendChild(btn);
    }
    return card;
  }

  function colActions(col) {
    const actions = el('div', 'col-actions');

    actions.appendChild(iconBtn('↗', '在新窗口打开全部', () => {
      if (col.tabs.length > 0) chrome.windows.create({ url: col.tabs.map(t => t.url) });
    }));

    actions.appendChild(iconBtn('⬇', '把当前窗口的标签保存到此收藏集', async () => {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const savable = tabs.filter(t => Store.isSavableUrl(t.url));
      if (savable.length === 0) return;
      await Store.addTabs(col.id, savable.map(t => ({ title: t.title, url: t.url })));
      await load();
    }));

    const starBtn = iconBtn(col.starred ? '★' : '☆', col.starred ? '取消星标' : '设为星标', async () => {
      await Store.updateCollection(col.id, { starred: !col.starred });
      await load();
    });
    if (col.starred) starBtn.classList.add('starred-on');
    actions.appendChild(starBtn);

    actions.appendChild(iconBtn('⧉', '复制收藏集', async () => {
      await Store.duplicateCollection(col.id);
      await load();
    }));

    actions.appendChild(iconBtn('🔗', '复制全部链接', async (e, btn) => {
      const text = col.tabs.map(t => t.url).join('\n');
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = '🔗'; }, 1200);
      } catch (err) {
        prompt('复制以下链接', text);
      }
    }));

    actions.appendChild(iconBtn('⋮', '更多', (e, btn) => {
      toggleColMenu(col, btn.closest('.collection-header'));
    }));

    return actions;
  }

  function renderMain(query) {
    const visible = visibleCollections();
    const q = (query || '').trim().toLowerCase();

    spaceTitleEl.textContent = showStarred ? '星标收藏集' : (selectedSpace || selectedOrg || '全部收藏集');
    colCountEl.textContent = `| ${visible.length} 个收藏集`;

    sectionsEl.textContent = '';
    let anyCard = false;

    for (const col of visible) {
      const tabs = q
        ? col.tabs.filter(t => (t.title || '').toLowerCase().includes(q) || (t.url || '').toLowerCase().includes(q))
        : col.tabs;
      if (q && tabs.length === 0) continue;

      const section = el('section', 'collection' + (collapsedIds.has(col.id) && !q ? ' collapsed' : ''));

      const header = el('div', 'collection-header');
      header.appendChild(el('span', 'caret', '▾'));
      header.appendChild(el('h3', '', col.name));
      if (col.starred) header.appendChild(el('span', 'star-mark', '★'));
      header.appendChild(el('span', 'count', `${col.tabs.length} 个`));
      header.appendChild(colActions(col));
      header.addEventListener('click', () => {
        if (collapsedIds.has(col.id)) collapsedIds.delete(col.id);
        else collapsedIds.add(col.id);
        section.classList.toggle('collapsed');
      });
      section.appendChild(header);

      const cards = el('div', 'cards');
      tabs.forEach((tab) => {
        cards.appendChild(bookmarkCard(tab, {
          onRemove: async () => {
            await Store.deleteTab(col.id, col.tabs.indexOf(tab));
            await load();
          }
        }));
      });
      if (tabs.length > 0) anyCard = true;
      section.appendChild(cards);
      sectionsEl.appendChild(section);
    }

    emptyEl.hidden = collections.length > 0;
    noResultsEl.hidden = !(q && !anyCard && openResultsEl.children.length === 0);
  }

  /* ---------- 搜索 ---------- */

  let debounceTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, 120);
  });

  async function runSearch() {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) {
      searchOpenWrap.hidden = true;
      openResultsEl.textContent = '';
      renderMain('');
      return;
    }

    const openTabs = await chrome.tabs.query({});
    const selfPrefix = chrome.runtime.getURL('');
    const openMatches = openTabs.filter(t =>
      t.url && !t.url.startsWith(selfPrefix) &&
      ((t.title || '').toLowerCase().includes(q) || (t.url || '').toLowerCase().includes(q)));

    openResultsEl.textContent = '';
    for (const t of openMatches) {
      const card = bookmarkCard({ title: t.title, url: t.url });
      card.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.update(t.id, { active: true });
        chrome.windows.update(t.windowId, { focused: true });
      });
      openResultsEl.appendChild(card);
    }
    searchOpenWrap.hidden = openMatches.length === 0;

    renderMain(q);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    } else if (e.key === 'Escape' && document.activeElement === searchInput) {
      searchInput.value = '';
      runSearch();
      searchInput.blur();
    }
  });

  /* ---------- 右栏：打开的标签 ---------- */

  async function renderOpenTabs() {
    const [tabs, windows] = await Promise.all([
      chrome.tabs.query({}),
      chrome.windows.getAll({ windowTypes: ['normal'] })
    ]);
    const selfPrefix = chrome.runtime.getURL('');
    const winIds = windows.map(w => w.id).sort((a, b) => a - b);

    windowListEl.textContent = '';
    winIds.forEach((winId, i) => {
      const winTabs = tabs.filter(t => t.windowId === winId && t.url && !t.url.startsWith(selfPrefix));
      if (winTabs.length === 0) return;

      const block = el('div', 'window-block');
      const header = el('div', 'window-header');
      header.appendChild(el('span', '', `窗口 ${i + 1}`));
      header.appendChild(el('span', 'muted', `(${winTabs.length})`));

      const actions = el('div', 'win-actions');
      const saveBtn = el('button', '', '⬇');
      saveBtn.title = '把该窗口保存为收藏集';
      saveBtn.addEventListener('click', async () => {
        const name = `窗口 ${i + 1} · ` + new Date().toLocaleString('zh-CN', {
          month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const savable = winTabs.filter(t => Store.isSavableUrl(t.url));
        if (savable.length === 0) return;
        await Store.addCollection(name, savable.map(t => ({ title: t.title, url: t.url })), {
          org: selectedOrg === null ? '' : selectedOrg,
          space: selectedSpace || ''
        });
        await load();
      });
      actions.appendChild(saveBtn);
      header.appendChild(actions);
      block.appendChild(header);

      for (const t of winTabs) {
        const row = el('div', 'open-tab-row' + (t.active ? ' active-tab' : ''));
        row.appendChild(faviconImg(t.url, t.title));
        row.appendChild(el('span', 'ot-title', t.title || t.url));
        row.title = t.url;
        row.addEventListener('click', () => {
          chrome.tabs.update(t.id, { active: true });
          chrome.windows.update(t.windowId, { focused: true });
        });
        block.appendChild(row);
      }
      windowListEl.appendChild(block);
    });
  }

  let tabsDebounce;
  function scheduleRenderOpenTabs() {
    clearTimeout(tabsDebounce);
    tabsDebounce = setTimeout(renderOpenTabs, 200);
  }
  for (const ev of ['onCreated', 'onRemoved', 'onUpdated', 'onMoved', 'onAttached', 'onDetached', 'onActivated']) {
    chrome.tabs[ev].addListener(scheduleRenderOpenTabs);
  }
  chrome.windows.onRemoved.addListener(scheduleRenderOpenTabs);
  chrome.windows.onCreated.addListener(scheduleRenderOpenTabs);

  /* ---------- 顶部操作 ---------- */

  myCollectionsBtn.addEventListener('click', () => {
    selectedSpace = null;
    showStarred = false;
    render();
  });

  starredBtn.addEventListener('click', () => {
    showStarred = !showStarred;
    selectedSpace = null;
    render();
  });

  expandAllBtn.addEventListener('click', () => {
    collapsedIds.clear();
    renderMain(searchInput.value);
  });

  collapseAllBtn.addEventListener('click', () => {
    for (const c of visibleCollections()) collapsedIds.add(c.id);
    renderMain(searchInput.value);
  });

  async function addCollection() {
    const name = prompt('收藏集名称');
    if (!name || !name.trim()) return;
    await Store.addCollection(name.trim(), [], {
      org: selectedOrg === null ? '' : selectedOrg,
      space: selectedSpace || ''
    });
    await load();
  }
  addCollectionBtn.addEventListener('click', addCollection);
  railAddBtn.addEventListener('click', addCollection);

  addSpaceBtn.addEventListener('click', async () => {
    const name = prompt('空间名称（会创建一个空收藏集占位，可随后重命名）');
    if (!name || !name.trim()) return;
    await Store.addCollection('未命名收藏集', [], {
      org: selectedOrg === null ? '' : selectedOrg,
      space: name.trim()
    });
    selectedSpace = name.trim();
    showStarred = false;
    await load();
  });

  /* ---------- 导入 / 导出 ---------- */

  exportBtn.addEventListener('click', async () => {
    const json = await Store.exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tabshelf-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  importBtn.addEventListener('click', () => importFile.click());

  importFile.addEventListener('change', async () => {
    const file = importFile.files[0];
    importFile.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const mode = confirm(
        '「确定」= 覆盖现有数据\n「取消」= 合并到现有数据'
      ) ? 'overwrite' : 'merge';
      const n = await Store.importData(text, mode);
      alert(`已导入 ${n} 个收藏集`);
      selectedOrg = null;
      selectedSpace = null;
      showStarred = false;
      await load();
    } catch (e) {
      alert('导入失败：' + e.message);
    }
  });

  /* ---------- 启动 ---------- */

  function render() {
    renderRail();
    renderSpaces();
    renderMain(searchInput.value);
  }

  async function load() {
    collections = await Store.getAll();
    render();
  }

  load();
  renderOpenTabs();
})();
