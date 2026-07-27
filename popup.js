(function () {
  'use strict';

  const META_LAST = 'lastCollectionId';
  const META_ORG = 'popupOrg';
  const INBOX_NAME = '收集箱';
  const DEFAULT_ORG = '个人';

  const orgSwitcher = document.getElementById('orgSwitcher');
  const orgAvatar = document.getElementById('orgAvatar');
  const orgNameEl = document.getElementById('orgName');
  const orgDropdown = document.getElementById('orgDropdown');
  const searchInput = document.getElementById('search');
  const treeEl = document.getElementById('tree');
  const statusEl = document.getElementById('status');
  const closeCheckbox = document.getElementById('closeTabs');
  const saveTabBtn = document.getElementById('saveTab');
  const saveWindowBtn = document.getElementById('saveWindow');
  const workbenchBtn = document.getElementById('openWorkbench');

  let collections = [];
  let currentTab = null;
  let currentOrg = '';           // 原始 org 值，'' 表示默认组织
  let view = { type: 'spaces' }; // {type:'spaces'} | {type:'space', space}

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  const orgDisplay = raw => raw || DEFAULT_ORG;

  function orgColor(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `hsl(${h}, 55%, 45%)`;
  }

  function isSavable(tab) {
    return tab && Store.isSavableUrl(tab.url);
  }

  let statusTimer;
  function status(msg, isError) {
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', !!isError);
    clearTimeout(statusTimer);
    if (!isError) statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 2500);
  }

  const inOrg = () => collections.filter(c => (c.org || '') === currentOrg);
  const inSpace = space => inOrg().filter(c => (c.space || '') === space);
  const spaceNames = () =>
    [...new Set(inOrg().map(c => c.space || '').filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));

  /* ---------- 组织切换 ---------- */

  function orgList() {
    const orgs = [...new Set(collections.map(c => c.org || ''))];
    return orgs.length ? orgs : [''];
  }

  function renderOrgHeader() {
    const name = orgDisplay(currentOrg);
    orgAvatar.textContent = name.slice(0, 2);
    orgAvatar.style.background = orgColor(name);
    orgNameEl.textContent = name;
    orgSwitcher.querySelector('.caret').style.visibility =
      orgList().length > 1 ? 'visible' : 'hidden';
  }

  function renderOrgDropdown() {
    orgDropdown.textContent = '';
    for (const raw of orgList()) {
      const name = orgDisplay(raw);
      const opt = el('button', 'org-option' + (raw === currentOrg ? ' active' : ''));
      const avatar = el('span', 'avatar small', name.slice(0, 2));
      avatar.style.background = orgColor(name);
      opt.appendChild(avatar);
      opt.appendChild(el('span', '', name));
      opt.addEventListener('click', async () => {
        currentOrg = raw;
        view = { type: 'spaces' };
        await chrome.storage.local.set({ [META_ORG]: raw });
        orgDropdown.hidden = true;
        renderOrgHeader();
        render();
      });
      orgDropdown.appendChild(opt);
    }
  }

  orgSwitcher.addEventListener('click', (e) => {
    e.stopPropagation();
    if (orgList().length <= 1) return;
    if (orgDropdown.hidden) {
      renderOrgDropdown();
      orgDropdown.hidden = false;
    } else {
      orgDropdown.hidden = true;
    }
  });

  document.addEventListener('click', (e) => {
    if (!orgDropdown.hidden && !orgDropdown.contains(e.target)) {
      orgDropdown.hidden = true;
    }
  });

  /* ---------- 视图：空间列表 ---------- */

  function spaceRow(icon, label, count, space) {
    const row = el('div', 'space-row');

    row.appendChild(el('span', 'icon', icon));
    row.appendChild(el('span', 'row-label', label));
    row.appendChild(el('span', 'count', String(count)));

    const saveBtn = el('button', 'row-save', '⬇');
    saveBtn.title = `保存当前标签到「${label}」`;
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      saveTabToSpace(space);
    });
    row.appendChild(saveBtn);

    row.appendChild(el('span', 'chevron', '›'));
    row.addEventListener('click', () => {
      view = { type: 'space', space };
      render();
    });
    return row;
  }

  function renderSpaces() {
    treeEl.textContent = '';
    treeEl.appendChild(spaceRow('🔖', '未分类收藏集', inSpace('').length, ''));
    for (const space of spaceNames()) {
      treeEl.appendChild(spaceRow('👥', space, inSpace(space).length, space));
    }
    if (collections.length === 0) {
      treeEl.appendChild(el('div', 'tree-empty', '还没有收藏集，点击上方「保存标签」创建'));
    }
  }

  /* ---------- 视图：空间详情 ---------- */

  function renderSpaceView(space) {
    const label = space || '未分类收藏集';
    const cols = inSpace(space);
    treeEl.textContent = '';

    const nav = el('div', 'space-nav');
    const backBtn = el('button', 'nav-btn', '‹');
    backBtn.title = '返回';
    backBtn.addEventListener('click', () => {
      view = { type: 'spaces' };
      render();
    });
    nav.appendChild(backBtn);
    nav.appendChild(el('span', 'space-title', label));

    const saveBtn = el('button', 'nav-btn', '⬇');
    saveBtn.title = `保存当前标签到「${label}」`;
    saveBtn.addEventListener('click', () => saveTabToSpace(space));
    nav.appendChild(saveBtn);

    const addBtn = el('button', 'nav-btn', '+');
    addBtn.title = '在该空间新建收藏集';
    addBtn.addEventListener('click', async () => {
      const name = prompt('收藏集名称');
      if (!name || !name.trim()) return;
      await Store.addCollection(name.trim(), [], { org: currentOrg, space });
      collections = await Store.getAll();
      render();
    });
    nav.appendChild(addBtn);
    treeEl.appendChild(nav);

    if (cols.length === 0) {
      treeEl.appendChild(el('div', 'tree-empty', '该空间还没有收藏集，点右上角 + 新建'));
      return;
    }
    for (const col of cols) {
      const row = el('button', 'col-row');
      row.appendChild(el('span', 'col-name', col.name));
      row.appendChild(el('span', 'count', `${col.tabs.length} 个标签`));
      row.title = `保存当前标签到「${col.name}」`;
      row.addEventListener('click', () => saveCurrentTab(col.id));
      treeEl.appendChild(row);
    }
  }

  /* ---------- 搜索（平铺结果） ---------- */

  function renderSearch(q) {
    treeEl.textContent = '';
    let any = false;

    for (const space of spaceNames()) {
      if (space.toLowerCase().includes(q)) {
        any = true;
        treeEl.appendChild(spaceRow('👥', space, inSpace(space).length, space));
      }
    }
    for (const col of inOrg()) {
      if (col.name.toLowerCase().includes(q)) {
        any = true;
        const row = el('button', 'col-row');
        row.appendChild(el('span', 'col-name', col.name));
        row.appendChild(el('span', 'count',
          (col.space ? col.space + ' · ' : '') + `${col.tabs.length} 个标签`));
        row.title = `保存当前标签到「${col.name}」`;
        row.addEventListener('click', () => saveCurrentTab(col.id));
        treeEl.appendChild(row);
      }
    }
    if (!any) treeEl.appendChild(el('div', 'tree-empty', '没有匹配的收藏集或空间'));
  }

  function render() {
    const q = searchInput.value.trim().toLowerCase();
    if (q) {
      renderSearch(q);
    } else if (view.type === 'space') {
      renderSpaceView(view.space);
    } else {
      renderSpaces();
    }
  }

  searchInput.addEventListener('input', render);

  /* ---------- 保存 ---------- */

  async function saveCurrentTab(collectionId) {
    if (!isSavable(currentTab)) {
      status('当前页面无法保存（内部页面）', true);
      return;
    }
    await Store.addTab(collectionId, { title: currentTab.title, url: currentTab.url });
    await chrome.storage.local.set({ [META_LAST]: collectionId });
    const col = collections.find(c => c.id === collectionId);
    status(`已保存到「${col ? col.name : ''}」`);
    if (closeCheckbox.checked) chrome.tabs.remove(currentTab.id);
    collections = await Store.getAll();
    render();
  }

  /** 保存到空间：存入该空间下的同名默认收藏集（全部收藏集用「收集箱」），没有则创建 */
  async function saveTabToSpace(space) {
    if (!isSavable(currentTab)) {
      status('当前页面无法保存（内部页面）', true);
      return;
    }
    const defName = space || INBOX_NAME;
    let target = inSpace(space).find(c => c.name === defName);
    if (!target) {
      target = await Store.addCollection(defName, [], { org: currentOrg, space });
      collections = await Store.getAll();
    }
    await saveCurrentTab(target.id);
  }

  /** 快捷保存：存入最近使用的收藏集，没有则建「收集箱」 */
  saveTabBtn.addEventListener('click', async () => {
    if (!isSavable(currentTab)) {
      status('当前页面无法保存（内部页面）', true);
      return;
    }
    const meta = await chrome.storage.local.get(META_LAST);
    let target = collections.find(c => c.id === meta[META_LAST]);
    if (!target) {
      target = collections.find(c => c.name === INBOX_NAME) ||
               await Store.addCollection(INBOX_NAME, [], { org: currentOrg });
    }
    await saveCurrentTab(target.id);
  });

  saveWindowBtn.addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const savable = tabs.filter(isSavable);
    if (savable.length === 0) {
      status('当前窗口没有可保存的标签', true);
      return;
    }
    const name = '收藏集 ' + new Date().toLocaleString('zh-CN', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const opts = { org: currentOrg };
    if (view.type === 'space') opts.space = view.space;
    await Store.addCollection(name, savable.map(t => ({ title: t.title, url: t.url })), opts);
    status(`已保存 ${savable.length} 个标签到「${name}」`);
    if (closeCheckbox.checked) {
      await chrome.tabs.remove(savable.map(t => t.id));
    }
    collections = await Store.getAll();
    render();
  });

  workbenchBtn.addEventListener('click', () => chrome.tabs.create({}));

  /* ---------- 启动 ---------- */

  (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
    collections = await Store.getAll();

    const meta = await chrome.storage.local.get(META_ORG);
    const orgs = orgList();
    currentOrg = orgs.includes(meta[META_ORG]) ? meta[META_ORG] : orgs[0];

    renderOrgHeader();
    render();
  })();
})();
