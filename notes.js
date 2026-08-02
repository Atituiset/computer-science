/**
 * 学习笔记 · 心得记录 (localStorage 版)
 *
 * - 每页独立笔记, 默认只存当前浏览器 (localStorage, 无账号 / 无数据库)
 * - 一键复制 Markdown (可粘贴到 GitHub Discussions / 任意笔记软件)
 * - 一键导出为 GitHub Issue: 预填 issues/new?title=...&body=... 链接, 无需 token
 * - Discussions 没有"预填新建讨论"链接, 所以用复制 Markdown 代替; 后续可接 OAuth 走 GraphQL
 *
 * 挂载: book.toml -> [output.html] additional-js
 */
(function () {
  'use strict';

  var LS_PREFIX = 'cs-notes:v1:';
  var GITHUB_REPO = 'Atituiset/computer-science';

  function pageKey() {
    return location.pathname.replace(/\/+$/, '') || '/';
  }

  function pageTitle() {
    return (document.title || '未命名页面').replace(/\s*[-–—|·].*$/, '').trim() || '未命名页面';
  }

  function readNotes(path) {
    try {
      var raw = localStorage.getItem(LS_PREFIX + path);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function writeNotes(path, notes) {
    try {
      localStorage.setItem(LS_PREFIX + path, JSON.stringify(notes));
      return true;
    } catch (e) {
      alert('笔记保存失败: 浏览器本地存储已满或不可用。' + (e && e.message ? ' (' + e.message + ')' : ''));
      return false;
    }
  }

  function uid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function toMarkdown(note) {
    var title = note.pageTitle || pageTitle();
    return '**学习笔记 · ' + fmtTime(note.ts) + '**\n来自: [' + title + '](' +
      (note.pageUrl || location.href) + ')\n\n' + note.content;
  }

  function copyText(text, okMsg) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        toast(okMsg || '已复制');
      } catch (e) {
        toast('复制失败, 请手动复制');
      }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg || '已复制'); }, fallback);
    } else {
      fallback();
    }
  }

  function exportIssue(note) {
    var title = '📝 学习笔记: ' + (note.pageTitle || pageTitle());
    var body = toMarkdown(note);
    var url = 'https://github.com/' + GITHUB_REPO + '/issues/new?title=' +
      encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
    window.open(url, '_blank');
  }

  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('cs-notes-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cs-notes-toast';
      el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#111827;color:#f9fafb;padding:8px 16px;border-radius:8px;font-size:13px;z-index:10002;box-shadow:0 4px 12px rgba(0,0,0,.35);opacity:0;transition:opacity .25s;pointer-events:none;max-width:80vw;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.style.opacity = '0'; }, 2200);
  }

  var state = { tab: 'page', path: pageKey() };

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function buildNoteItem(note, path) {
    var item = el('div', 'cn-item');
    var meta = el('div', 'cn-meta', fmtTime(note.ts) + (path ? ' · ' + path : ''));
    var text = el('div', 'cn-text', '');
    text.textContent = note.content;
    var ops = el('div', 'cn-ops');
    var btnCopy = el('button', '', '复制');
    btnCopy.addEventListener('click', function () { copyText(toMarkdown(note), '已复制, 可粘贴到 Discussions'); });
    var btnIssue = el('button', '', 'Issue');
    btnIssue.addEventListener('click', function () { exportIssue(note); });
    var btnDel = el('button', 'cn-del', '删除');
    btnDel.addEventListener('click', function () {
      if (!confirm('删除这条笔记? (不可恢复, 导出前请先复制)')) return;
      var notes = readNotes(path);
      writeNotes(path, notes.filter(function (n) { return n.id !== note.id; }));
      render();
      toast('已删除');
    });
    ops.appendChild(btnCopy);
    ops.appendChild(btnIssue);
    ops.appendChild(btnDel);
    item.appendChild(meta);
    item.appendChild(text);
    item.appendChild(ops);
    return item;
  }

  function render() {
    var body = document.getElementById('cs-notes-body');
    if (!body) return;
    body.textContent = '';

    if (state.tab === 'page') {
      var notes = readNotes(state.path);
      if (!notes.length) {
        body.appendChild(el('div', 'cn-empty', '本页还没有笔记'));
        return;
      }
      notes.forEach(function (n) { body.appendChild(buildNoteItem(n, state.path)); });
    } else {
      var any = false;
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var key = localStorage.key(i);
          if (!key || key.indexOf(LS_PREFIX) !== 0) continue;
          var path = key.slice(LS_PREFIX.length);
          var list = readNotes(path);
          if (!list.length) continue;
          any = true;
          body.appendChild(el('div', 'cn-page', path));
          list.forEach(function (n) { body.appendChild(buildNoteItem(n, path)); });
        }
      } catch (e) { /* ignore */ }
      if (!any) body.appendChild(el('div', 'cn-empty', '还没有任何笔记'));
    }
  }

  function saveNote() {
    var ta = document.getElementById('cs-notes-input');
    var content = ta.value.trim();
    if (!content) {
      toast('先写点内容再保存');
      return;
    }
    var notes = readNotes(state.path);
    notes.unshift({ id: uid(), ts: Date.now(), content: content, pageTitle: pageTitle(), pageUrl: location.href });
    if (writeNotes(state.path, notes)) {
      ta.value = '';
      render();
      toast('已保存到本浏览器');
    }
  }

  function init() {
    if (document.getElementById('cs-notes-root')) return;

    var style = document.createElement('style');
    style.textContent = [
      '#cs-notes-fab{position:fixed;right:20px;bottom:20px;width:52px;height:52px;border-radius:50%;border:none;cursor:pointer;font-size:22px;background:#2563eb;color:#fff;box-shadow:0 6px 18px rgba(0,0,0,.3);z-index:10000;display:flex;align-items:center;justify-content:center;}',
      '#cs-notes-fab:hover{background:#1d4ed8;}',
      '#cs-notes-panel{position:fixed;right:20px;bottom:84px;width:min(400px,calc(100vw - 40px));max-height:72vh;background:#fff;color:#1f2937;border:1px solid #d1d5db;border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.25);z-index:10001;display:none;flex-direction:column;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;line-height:1.5;}',
      '#cs-notes-panel.open{display:flex;}',
      '#cs-notes-panel .cn-head{padding:10px 12px;background:#f3f4f6;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;gap:8px;}',
      '#cs-notes-panel .cn-head b{flex:1;font-size:14px;color:#111827;}',
      '#cs-notes-panel .cn-head span{color:#6b7280;font-size:11px;max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '#cs-notes-panel .cn-close{border:none;background:none;cursor:pointer;font-size:16px;color:#6b7280;padding:0 4px;}',
      '#cs-notes-panel .cn-tabs{display:flex;border-bottom:1px solid #e5e7eb;}',
      '#cs-notes-panel .cn-tab{flex:1;padding:7px;text-align:center;cursor:pointer;background:none;border:none;color:#6b7280;border-bottom:2px solid transparent;font-size:13px;}',
      '#cs-notes-panel .cn-tab.active{color:#2563eb;border-bottom-color:#2563eb;font-weight:600;}',
      '#cs-notes-panel .cn-body{padding:10px 12px;overflow:auto;flex:1;min-height:120px;}',
      '#cs-notes-panel textarea{width:100%;box-sizing:border-box;min-height:96px;border:1px solid #d1d5db;border-radius:8px;padding:8px;font:inherit;color:#111827;background:#fff;resize:vertical;}',
      '#cs-notes-panel .cn-save{margin-top:6px;background:#2563eb;color:#fff;border:none;border-radius:8px;padding:7px 14px;cursor:pointer;font-size:13px;}',
      '#cs-notes-panel .cn-save:hover{background:#1d4ed8;}',
      '#cs-notes-panel .cn-item{border:1px solid #e5e7eb;border-radius:8px;padding:8px;margin-top:8px;background:#fafafa;}',
      '#cs-notes-panel .cn-item .cn-meta{color:#6b7280;font-size:12px;margin-bottom:4px;word-break:break-all;}',
      '#cs-notes-panel .cn-item .cn-text{white-space:pre-wrap;word-break:break-word;max-height:140px;overflow:auto;margin:4px 0 6px;color:#111827;}',
      '#cs-notes-panel .cn-item .cn-ops button{border:1px solid #d1d5db;background:#fff;color:#374151;border-radius:6px;padding:3px 8px;margin-right:6px;cursor:pointer;font-size:12px;}',
      '#cs-notes-panel .cn-item .cn-ops button.cn-del{color:#dc2626;border-color:#fecaca;}',
      '#cs-notes-panel .cn-item .cn-ops button:hover{background:#f3f4f6;}',
      '#cs-notes-panel .cn-hint{color:#6b7280;font-size:12px;padding:8px 12px;border-top:1px solid #e5e7eb;background:#f9fafb;}',
      '#cs-notes-panel .cn-empty{color:#9ca3af;text-align:center;padding:18px 0;}',
      '#cs-notes-panel .cn-page{font-weight:600;color:#374151;margin:10px 0 2px;font-size:12px;word-break:break-all;}'
    ].join('\n');
    document.head.appendChild(style);

    var root = document.createElement('div');
    root.id = 'cs-notes-root';

    var fab = el('button', '', '📝');
    fab.id = 'cs-notes-fab';
    fab.setAttribute('aria-label', '打开学习笔记');
    fab.title = '学习笔记 (存本浏览器, 可导出 Issue)';
    fab.addEventListener('click', function () {
      var panel = document.getElementById('cs-notes-panel');
      var open = panel.classList.toggle('open');
      fab.style.display = open ? 'none' : 'flex';
      if (open) render();
    });

    var panel = el('div', '');
    panel.id = 'cs-notes-panel';
    var head = el('div', 'cn-head',
      '<b>学习笔记</b><span>' + pageTitle() + '</span>');
    var close = el('button', 'cn-close', '✕');
    close.title = '关闭';
    close.addEventListener('click', function () {
      panel.classList.remove('open');
      fab.style.display = 'flex';
    });
    head.appendChild(close);

    var tabs = el('div', 'cn-tabs',
      '<button class="cn-tab" data-tab="page">本页</button>' +
      '<button class="cn-tab" data-tab="all">全部</button>');
    tabs.querySelectorAll('.cn-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        state.tab = t.getAttribute('data-tab');
        tabs.querySelectorAll('.cn-tab').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        render();
      });
    });

    var body = el('div', 'cn-body');
    body.id = 'cs-notes-body';
    var editor = el('div', '');
    var ta = document.createElement('textarea');
    ta.id = 'cs-notes-input';
    ta.placeholder = '随手记点什么… (Markdown 可用)\n保存后默认只存在本浏览器; 需要沉淀时点"复制"或"Issue"。';
    var save = el('button', 'cn-save', '保存');
    save.addEventListener('click', saveNote);
    editor.appendChild(ta);
    editor.appendChild(save);

    var hint = el('div', 'cn-hint',
      '数据仅存本浏览器 (localStorage)。导出 Issue 后可在仓库沉淀; 复制 Markdown 可粘贴到 GitHub Discussions。');

    panel.appendChild(head);
    panel.appendChild(tabs);
    panel.appendChild(body);
    panel.appendChild(editor);
    panel.appendChild(hint);
    root.appendChild(fab);
    root.appendChild(panel);
    document.body.appendChild(root);

    tabs.querySelector('[data-tab="page"]').classList.add('active');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
