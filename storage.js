/* 数据层：chrome.storage.local 本地存储 + 导入导出 */
(function () {
  'use strict';

  const KEY = 'collections';
  const EXPORT_APP = 'tabshelf';
  const EXPORT_VERSION = 1;

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  }

  /** 当前打开的标签是否可保存（排除浏览器内部页面） */
  function isSavableUrl(url) {
    return !!url && !/^(chrome|edge|about|chrome-extension|moz-extension):/.test(url);
  }

  /** 导入数据的 URL 校验：只接受 http(s)，防止 javascript:/data: 等被存为可点击链接 */
  function isHttpUrl(url) {
    return typeof url === 'string' && /^https?:\/\//i.test(url);
  }

  /** 写操作排队串行执行，避免并发读改写互相覆盖丢数据 */
  let queue = Promise.resolve();
  function serialize(fn) {
    return (...args) => {
      const run = queue.then(() => fn(...args));
      queue = run.catch(() => {});
      return run;
    };
  }

  /** 旧数据迁移：v0.1 把 Toby 路径拍平进 name（"org / space / name"），拆回 org/space 字段 */
  function migrate(col) {
    if (col.space !== undefined) return false;
    const parts = String(col.name || '').split(' / ');
    if (parts.length >= 3) {
      col.org = parts[0];
      col.space = parts.slice(1, -1).join(' / ');
      col.name = parts[parts.length - 1];
    } else if (parts.length === 2) {
      col.org = parts[0];
      col.space = '';
      col.name = parts[1];
    } else {
      col.org = '';
      col.space = '';
    }
    return true;
  }

  /** bug 修复：newtab.js 曾把默认组织的展示名"个人"误存成真实 org 值，这里合并回真正的默认组织（空字符串） */
  function fixDefaultOrgLabel(col) {
    if (col.org === '个人') {
      col.org = '';
      return true;
    }
    return false;
  }

  async function getAll() {
    const data = await chrome.storage.local.get(KEY);
    const collections = data[KEY] || [];
    let dirty = false;
    for (const c of collections) dirty = migrate(c) || dirty;
    for (const c of collections) dirty = fixDefaultOrgLabel(c) || dirty;
    if (dirty) await saveAll(collections);
    return collections;
  }

  async function saveAll(collections) {
    await chrome.storage.local.set({ [KEY]: collections });
  }

  /** tabs: [{title, url}]，新收藏集排在最前；opts: {org, space} */
  async function addCollection(name, tabs, opts = {}) {
    const collections = await getAll();
    const col = {
      id: uid(),
      name: name || '未命名收藏集',
      org: opts.org || '',
      space: opts.space || '',
      starred: false,
      createdAt: Date.now(),
      tabs: (tabs || []).map(t => ({ title: t.title || t.url, url: t.url }))
    };
    collections.unshift(col);
    await saveAll(collections);
    return col;
  }

  async function renameCollection(id, name) {
    await updateCollection(id, { name });
  }

  /** 更新收藏集字段，patch: {name?, space?, starred?} */
  async function updateCollection(id, patch) {
    const collections = await getAll();
    const col = collections.find(c => c.id === id);
    if (col) {
      Object.assign(col, patch);
      await saveAll(collections);
    }
  }

  /** 复制收藏集，插入到原收藏集之后 */
  async function duplicateCollection(id) {
    const collections = await getAll();
    const idx = collections.findIndex(c => c.id === id);
    if (idx === -1) return;
    const src = collections[idx];
    collections.splice(idx + 1, 0, {
      ...src,
      id: uid(),
      name: src.name + ' 副本',
      starred: false,
      createdAt: Date.now(),
      tabs: src.tabs.map(t => ({ ...t }))
    });
    await saveAll(collections);
  }

  async function deleteCollection(id) {
    const collections = await getAll();
    await saveAll(collections.filter(c => c.id !== id));
  }

  async function deleteTab(collectionId, index) {
    const collections = await getAll();
    const col = collections.find(c => c.id === collectionId);
    if (col && col.tabs[index]) {
      col.tabs.splice(index, 1);
      await saveAll(collections);
    }
  }

  /** 追加一个标签到指定收藏集 */
  async function addTab(collectionId, tab) {
    await addTabs(collectionId, [tab]);
  }

  /** 批量追加标签到指定收藏集 */
  async function addTabs(collectionId, tabs) {
    const collections = await getAll();
    const col = collections.find(c => c.id === collectionId);
    if (!col) throw new Error('收藏集不存在');
    for (const t of tabs) col.tabs.push({ title: t.title || t.url, url: t.url });
    await saveAll(collections);
  }

  /** 导出为 JSON 字符串 */
  async function exportData() {
    return JSON.stringify({
      app: EXPORT_APP,
      version: EXPORT_VERSION,
      exportedAt: Date.now(),
      collections: await getAll()
    }, null, 2);
  }

  /** 校验并规范化导入数据，返回收藏集数组 */
  function normalize(raw) {
    // Toby 导出格式：organizations → spaces → collections → bookmarks，拍平并保留 org/space
    if (raw && raw.format === 'Toby bookmarks export') return normalizeToby(raw);

    const list = Array.isArray(raw) ? raw : raw && raw.collections;
    if (!Array.isArray(list)) throw new Error('文件格式不正确');
    return list.map(c => ({
      id: uid(),
      name: String((c && c.name) || '未命名收藏集'),
      org: String((c && c.org) || ''),
      space: String((c && c.space) || ''),
      starred: !!(c && c.starred),
      createdAt: Number(c && c.createdAt) || Date.now(),
      tabs: (Array.isArray(c && c.tabs) ? c.tabs : [])
        .filter(t => t && isHttpUrl(t.url))
        .map(t => ({ title: String(t.title || t.url), url: t.url }))
    }));
  }

  /** Toby 层级拍平：org/space 存为字段，顺序按 position */
  function normalizeToby(raw) {
    const out = [];
    for (const org of raw.organizations || []) {
      const spaces = [...(org.spaces || [])].sort((a, b) => (a.position || 0) - (b.position || 0));
      for (const space of spaces) {
        const cols = [...(space.collections || [])].sort((a, b) => (a.position || 0) - (b.position || 0));
        for (const c of cols) {
          out.push({
            id: uid(),
            name: String(c.title || '未命名收藏集'),
            org: String(org.name || ''),
            space: space.name && space.name !== 'Unnamed space' ? String(space.name) : '',
            starred: !!c.starred,
            createdAt: Date.parse(c.createdAt) || Date.now(),
            tabs: (Array.isArray(c.bookmarks) ? c.bookmarks : [])
              .filter(b => b && isHttpUrl(b.url))
              .map(b => ({ title: String(b.title || b.url), url: b.url }))
          });
        }
      }
    }
    if (out.length === 0) throw new Error('Toby 导出文件中没有收藏集');
    return out;
  }

  /** mode: 'merge' 合并到现有数据前 | 'overwrite' 覆盖。返回导入的收藏集数量 */
  async function importData(jsonText, mode) {
    const incoming = normalize(JSON.parse(jsonText));
    if (mode === 'overwrite') {
      await saveAll(incoming);
    } else {
      const existing = await getAll();
      await saveAll(incoming.concat(existing));
    }
    return incoming.length;
  }

  window.Store = {
    getAll: serialize(getAll),
    saveAll: serialize(saveAll),
    addCollection: serialize(addCollection),
    renameCollection: serialize(renameCollection),
    updateCollection: serialize(updateCollection),
    duplicateCollection: serialize(duplicateCollection),
    deleteCollection: serialize(deleteCollection),
    deleteTab: serialize(deleteTab),
    addTab: serialize(addTab),
    addTabs: serialize(addTabs),
    exportData: serialize(exportData),
    importData: serialize(importData),
    isSavableUrl
  };
})();
