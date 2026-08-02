/**
 * 学习笔记 · 心得记录 (localStorage 版)
 *
 * - 划词笔记: 在正文任意位置用鼠标选中文字, 出现"记笔记"工具条
 * - 笔记锚定到选中文本: 以字符偏移存储, 刷新页面后自动重新高亮
 * - 数据默认只存当前浏览器 (localStorage, 无账号 / 无数据库)
 * - 一键复制 Markdown (可粘贴到 GitHub Discussions / 任意笔记软件)
 * - 一键导出为 GitHub Issue: 预填 issues/new?title=...&body=... 链接, 无需 token
 *
 * 挂载: book.toml -> [output.html] additional-js
 */
(function () {
  'use strict';

  var LS_PREFIX = 'cs-notes:v1:';
  var GITHUB_REPO = 'Atituiset/computer-science';

  function contentEl() {
    return document.getElementById('content') || document.body;
  }

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

  function findNote(path, id) {
    var list = readNotes(path);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
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

  // ---------- 选中文本 <-> 字符偏移 (#content 内) ----------

  function textLengthUpTo(boundaryNode, boundaryOffset) {
    var container = contentEl();
    if (boundaryNode.nodeType === 3) {
      var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      var total = 0, n;
      while ((n = walker.nextNode())) {
        if (n === boundaryNode) {
          return total + Math.min(boundaryOffset, n.nodeValue.length);
        }
        total += n.nodeValue.length;
      }
      return total;
    }
    // element boundary (rare): 边界元素内 offset 之前的子节点文本
    var prefix = 0;
    for (var i = 0; i < boundaryOffset && i < boundaryNode.childNodes.length; i++) {
      var c = boundaryNode.childNodes[i];
      if (c.nodeType === 3) {
        prefix += c.nodeValue.length;
      } else if (c.nodeType === 1) {
        prefix += c.textContent.length;
      }
    }
    var total2 = 0, m;
    var walker2 = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    while ((m = walker2.nextNode())) {
      if (boundaryNode.contains(m)) {
        return total2 + prefix;
      }
      total2 += m.nodeValue.length;
    }
    return total2 + prefix;
  }

  function captureSelection() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    var range = sel.getRangeAt(0);
    var container = contentEl();
    if (!container.contains(range.commonAncestorContainer)) return null;
    var start = textLengthUpTo(range.startContainer, range.startOffset);
    var end = textLengthUpTo(range.endContainer, range.endOffset);
    if (start > end) { var t = start; start = end; end = t; }
    if (end <= start) return null;
    var text = range.toString().replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return { start: start, end: end, text: text.slice(0, 300) };
  }

  function applyHighlight(note) {
    if (!note.sel || typeof note.sel.start !== 'number' || typeof note.sel.end !== 'number') return;
    var start = note.sel.start, end = note.sel.end;
    if (end <= start) return;
    // 先快照全部文本节点, 再逐个包裹 —— surroundContents 会改动 DOM,
    // 若用活 TreeWalker 继续遍历会重访刚包裹的节点, 造成嵌套高亮
    var walker = document.createTreeWalker(contentEl(), NodeFilter.SHOW_TEXT);
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    var pos = 0;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var len = node.nodeValue.length;
      var nodeStart = pos, nodeEnd = pos + len;
      pos = nodeEnd;
      if (nodeEnd <= start || nodeStart >= end) continue;
      var s = Math.max(0, start - nodeStart);
      var e = Math.min(len, end - nodeStart);
      if (e <= s) continue;
      try {
        var mark = document.createElement('mark');
        mark.className = 'cs-note-mark';
        mark.dataset.id = note.id;
        mark.title = (note.content || '').slice(0, 100);
        var r = document.createRange();
        r.setStart(node, s);
        r.setEnd(node, e);
        r.surroundContents(mark);
      } catch (err) { /* 跳过无法包裹的节点 (如 SVG) */ }
    }
  }

  function unwrapMarks(id) {
    var marks = document.querySelectorAll('.cs-note-mark');
    for (var i = marks.length - 1; i >= 0; i--) {
      var m = marks[i];
      if (id && m.dataset.id !== id) continue;
      var parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
    }
  }

  function applyAllMarks() {
    unwrapMarks();
    readNotes(pageKey()).forEach(applyHighlight);
  }

  function toMarkdown(note) {
    var title = note.pageTitle || pageTitle();
    var lines = ['**学习笔记 · ' + fmtTime(note.ts) + '**', '来自: [' + title + '](' +
      (note.pageUrl || location.href) + ')'];
    if (note.sel && note.sel.text) lines.push('', '> 划词: "' + note.sel.text + '"');
    lines.push('', note.content);
    return lines.join('\n');
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
    var url = 'https://github.com/' + GITHUB_REPO + '/issues/new?title=' +
      encodeURIComponent(title) + '&body=' + encodeURIComponent(toMarkdown(note));
    window.open(url, '_blank');
  }

  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('cs-notes-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cs-notes-toast';
      el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#111827;color:#f9fafb;padding:8px 16px;border-radius:8px;font-size:13px;z-index:10006;box-shadow:0 4px 12px rgba(0,0,0,.35);opacity:0;transition:opacity .25s;pointer-events:none;max-width:80vw;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.style.opacity = '0'; }, 2200);
  }

  var state = { tab: 'page', path: pageKey() };
  var pendingSel = null;

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  // ---------- 弹窗 (新建 / 编辑) ----------

  var popState = null; // { path, id }

  function openPopover(path, id, selInfo) {
    var pop = document.getElementById('cs-notes-pop');
    var quote = document.getElementById('cs-notes-pop-quote');
    var ta = document.getElementById('cs-notes-pop-input');
    var note = id ? findNote(path, id) : null;
    popState = { path: path, id: id || null };
    ta.value = note ? note.content : '';
    var selText = (note && note.sel && note.sel.text) || (selInfo && selInfo.text);
    if (selText) {
      quote.style.display = 'block';
      quote.textContent = '划词: "' + selText + '"';
    } else {
      quote.style.display = 'none';
    }
    pop.classList.add('open');
    ta.focus();
  }

  function closePopover() {
    document.getElementById('cs-notes-pop').classList.remove('open');
    popState = null;
  }

  function savePopover() {
    if (!popState) return;
    var ta = document.getElementById('cs-notes-pop-input');
    var content = ta.value.trim();
    if (!content) {
      toast('先写点内容再保存');
      return;
    }
    var notes = readNotes(popState.path);
    if (popState.id) {
      notes = notes.map(function (n) {
        if (n.id !== popState.id) return n;
        var copy = {};
        for (var k in n) {
          if (Object.prototype.hasOwnProperty.call(n, k)) copy[k] = n[k];
        }
        copy.content = content;
        return copy;
      });
    } else {
      notes.unshift({
        id: uid(), ts: Date.now(), content: content,
        pageTitle: pageTitle(), pageUrl: location.href,
        sel: pendingSel || null
      });
      pendingSel = null;
    }
    if (writeNotes(popState.path, notes)) {
      closePopover();
      applyAllMarks();
      render();
      toast('已保存到本浏览器');
    }
  }

  // ---------- 面板 (本页 / 全部) ----------

  function buildNoteItem(note, path) {
    var item = el('div', 'cn-item');
    var meta = el('div', 'cn-meta');
    meta.textContent = fmtTime(note.ts) + (path !== pageKey() ? ' · ' + path : '');
    var quote;
    if (note.sel && note.sel.text) {
      quote = el('div', 'cn-quote');
      quote.textContent = '“' + note.sel.text + '”';
    }
    var text = el('div', 'cn-text');
    text.textContent = note.content;
    var ops = el('div', 'cn-ops');

    var btnCopy = el('button', '', '复制');
    btnCopy.title = '复制 Markdown, 可粘贴到 Discussions';
    btnCopy.addEventListener('click', function () {
      copyText(toMarkdown(note), '已复制, 可粘贴到 Discussions');
    });
    var btnIssue = el('button', '', 'Issue');
    btnIssue.title = '导出为预填的 GitHub Issue';
    btnIssue.addEventListener('click', function () { exportIssue(note); });
    var btnEdit = el('button', '', '编辑');
    btnEdit.addEventListener('click', function () { openPopover(path, note.id); });
    var btnDel = el('button', 'cn-del', '删除');
    btnDel.addEventListener('click', function () {
      if (!confirm('删除这条笔记? (对应高亮会一并移除)')) return;
      var notes = readNotes(path);
      writeNotes(path, notes.filter(function (n) { return n.id !== note.id; }));
      if (path === pageKey()) unwrapMarks(note.id);
      render();
      toast('已删除');
    });

    ops.appendChild(btnCopy);
    ops.appendChild(btnIssue);
    ops.appendChild(btnEdit);
    ops.appendChild(btnDel);
    item.appendChild(meta);
    if (quote) item.appendChild(quote);
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
        body.appendChild(el('div', 'cn-empty', '本页还没有笔记 — 选中正文任意文字试试'));
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

  function hideSelbar() {
    var bar = document.getElementById('cs-notes-selbar');
    if (bar) bar.style.display = 'none';
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
      '#cs-notes-panel .cn-head span{color:#6b7280;font-size:11px;max-width:38%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '#cs-notes-panel .cn-add{background:#2563eb;color:#fff;border:none;border-radius:6px;padding:3px 9px;cursor:pointer;font-size:12px;}',
      '#cs-notes-panel .cn-close{border:none;background:none;cursor:pointer;font-size:16px;color:#6b7280;padding:0 4px;}',
      '#cs-notes-panel .cn-tabs{display:flex;border-bottom:1px solid #e5e7eb;}',
      '#cs-notes-panel .cn-tab{flex:1;padding:7px;text-align:center;cursor:pointer;background:none;border:none;color:#6b7280;border-bottom:2px solid transparent;font-size:13px;}',
      '#cs-notes-panel .cn-tab.active{color:#2563eb;border-bottom-color:#2563eb;font-weight:600;}',
      '#cs-notes-panel .cn-body{padding:10px 12px;overflow:auto;flex:1;min-height:120px;}',
      '#cs-notes-panel .cn-item{border:1px solid #e5e7eb;border-radius:8px;padding:8px;margin-top:8px;background:#fafafa;}',
      '#cs-notes-panel .cn-item .cn-meta{color:#6b7280;font-size:12px;margin-bottom:4px;word-break:break-all;}',
      '#cs-notes-panel .cn-item .cn-quote{background:#fffbeb;border-left:3px solid #f59e0b;color:#92400e;font-size:12px;padding:4px 6px;margin:4px 0;max-height:64px;overflow:auto;}',
      '#cs-notes-panel .cn-item .cn-text{white-space:pre-wrap;word-break:break-word;max-height:140px;overflow:auto;margin:4px 0 6px;color:#111827;}',
      '#cs-notes-panel .cn-item .cn-ops button{border:1px solid #d1d5db;background:#fff;color:#374151;border-radius:6px;padding:3px 8px;margin-right:6px;cursor:pointer;font-size:12px;}',
      '#cs-notes-panel .cn-item .cn-ops button.cn-del{color:#dc2626;border-color:#fecaca;}',
      '#cs-notes-panel .cn-item .cn-ops button:hover{background:#f3f4f6;}',
      '#cs-notes-panel .cn-hint{color:#6b7280;font-size:12px;padding:8px 12px;border-top:1px solid #e5e7eb;background:#f9fafb;}',
      '#cs-notes-panel .cn-empty{color:#9ca3af;text-align:center;padding:18px 0;}',
      '#cs-notes-panel .cn-page{font-weight:600;color:#374151;margin:10px 0 2px;font-size:12px;word-break:break-all;}',
      '.cs-note-mark{background:rgba(250,204,21,.30);color:inherit;border-bottom:1px solid rgba(250,204,21,.9);border-radius:2px;padding:0 1px;cursor:pointer;}',
      '.cs-note-mark:hover{background:rgba(250,204,21,.55);}',
      '#cs-notes-selbar{position:fixed;z-index:10003;display:none;align-items:center;gap:6px;background:#111827;color:#fff;border-radius:8px;padding:4px 6px;box-shadow:0 4px 14px rgba(0,0,0,.4);font-size:12px;}',
      '#cs-notes-selbar button{background:#2563eb;color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;}',
      '#cs-notes-selbar button:hover{background:#1d4ed8;}',
      '#cs-notes-pop{position:fixed;left:50%;top:22%;transform:translateX(-50%);width:min(500px,calc(100vw - 32px));background:#fff;color:#1f2937;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.35);z-index:10004;display:none;flex-direction:column;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;line-height:1.5;}',
      '#cs-notes-pop.open{display:flex;}',
      '#cs-notes-pop .cn-pop-head{padding:10px 12px;background:#f3f4f6;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;gap:8px;}',
      '#cs-notes-pop .cn-pop-head b{flex:1;font-size:14px;color:#111827;}',
      '#cs-notes-pop .cn-pop-head button{border:none;background:none;cursor:pointer;font-size:16px;color:#6b7280;padding:0 4px;}',
      '#cs-notes-pop .cn-pop-quote{display:none;background:#fffbeb;border-left:3px solid #f59e0b;color:#92400e;font-size:12px;padding:6px 8px;margin:8px 12px 0;max-height:72px;overflow:auto;white-space:pre-wrap;}',
      '#cs-notes-pop textarea{width:calc(100% - 24px);box-sizing:border-box;min-height:110px;margin:10px 12px 0;border:1px solid #d1d5db;border-radius:8px;padding:8px;font:inherit;color:#111827;background:#fff;resize:vertical;}',
      '#cs-notes-pop .cn-pop-ops{display:flex;justify-content:flex-end;gap:8px;padding:10px 12px 12px;}',
      '#cs-notes-pop .cn-pop-ops button{border:1px solid #d1d5db;background:#fff;color:#374151;border-radius:8px;padding:7px 14px;cursor:pointer;font-size:13px;}',
      '#cs-notes-pop .cn-pop-ops button.cn-save{background:#2563eb;color:#fff;border-color:#2563eb;}',
      '#cs-notes-pop .cn-pop-ops button.cn-save:hover{background:#1d4ed8;}'
    ].join('\n');
    document.head.appendChild(style);

    var root = document.createElement('div');
    root.id = 'cs-notes-root';

    // 悬浮按钮
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

    // 面板
    var panel = el('div', '');
    panel.id = 'cs-notes-panel';
    var head = el('div', 'cn-head',
      '<b>学习笔记</b><span>' + pageTitle() + '</span>');
    var btnAdd = el('button', 'cn-add', '+ 新笔记');
    btnAdd.addEventListener('click', function () { openPopover(state.path, null, null); });
    var close = el('button', 'cn-close', '✕');
    close.title = '关闭';
    close.addEventListener('click', function () {
      panel.classList.remove('open');
      fab.style.display = 'flex';
    });
    head.appendChild(btnAdd);
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
    var hint = el('div', 'cn-hint',
      '选中正文文字即可记笔记; 数据仅存本浏览器 (localStorage)。复制 Markdown 可粘贴到 Discussions, 导出 Issue 后在仓库沉淀。');
    panel.appendChild(head);
    panel.appendChild(tabs);
    panel.appendChild(body);
    panel.appendChild(hint);

    // 划词工具条
    var selbar = el('div', '');
    selbar.id = 'cs-notes-selbar';
    var selbarBtn = el('button', '', '📝 记笔记');
    selbarBtn.addEventListener('click', function () {
      if (pendingSel) {
        openPopover(pageKey(), null, pendingSel);
        hideSelbar();
      }
    });
    selbar.appendChild(selbarBtn);

    // 笔记弹窗
    var pop = el('div', '');
    pop.id = 'cs-notes-pop';
    var popHead = el('div', 'cn-pop-head',
      '<b>' + (pageTitle()) + '</b>');
    var popClose = el('button', '', '✕');
    popClose.title = '关闭';
    popClose.addEventListener('click', closePopover);
    popHead.appendChild(popClose);
    var popQuote = el('div', 'cn-pop-quote', '');
    popQuote.id = 'cs-notes-pop-quote';
    var popTa = document.createElement('textarea');
    popTa.id = 'cs-notes-pop-input';
    popTa.placeholder = '写下你的心得 / 补充… (Markdown 可用)';
    var popOps = el('div', 'cn-pop-ops',
      '<button type="button" id="cs-notes-pop-cancel">取消</button>' +
      '<button type="button" class="cn-save" id="cs-notes-pop-save">保存</button>');
    popOps.querySelector('#cs-notes-pop-cancel').addEventListener('click', closePopover);
    popOps.querySelector('#cs-notes-pop-save').addEventListener('click', savePopover);
    pop.appendChild(popHead);
    pop.appendChild(popQuote);
    pop.appendChild(popTa);
    pop.appendChild(popOps);

    root.appendChild(fab);
    root.appendChild(panel);
    root.appendChild(selbar);
    root.appendChild(pop);
    document.body.appendChild(root);
    tabs.querySelector('[data-tab="page"]').classList.add('active');

    // ---------- 事件 ----------

    document.addEventListener('mouseup', function (e) {
      if (e.target && e.target.closest && e.target.closest('#cs-notes-root')) return;
      var sel = window.getSelection();
      var container = contentEl();
      if (!sel || sel.isCollapsed) { hideSelbar(); return; }
      if (!container.contains(sel.anchorNode) || !container.contains(sel.focusNode)) { hideSelbar(); return; }
      var cap = captureSelection();
      if (!cap) { hideSelbar(); return; }
      pendingSel = cap;
      var rect = null;
      try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch (err) { rect = null; }
      if (rect && rect.width > 0) {
        selbar.style.display = 'flex';
        var x = Math.max(4, Math.min(rect.left, window.innerWidth - 170));
        var y = rect.bottom + 6;
        if (y + 34 > window.innerHeight) y = Math.max(4, rect.top - 34);
        selbar.style.left = x + 'px';
        selbar.style.top = y + 'px';
      }
    });

    document.addEventListener('mousedown', function (e) {
      if (!(e.target && e.target.closest && e.target.closest('#cs-notes-root'))) hideSelbar();
    });

    window.addEventListener('scroll', hideSelbar, true);
    window.addEventListener('resize', hideSelbar);

    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('#cs-notes-root')) return;
      var mark = e.target && e.target.closest ? e.target.closest('.cs-note-mark') : null;
      if (mark) {
        e.preventDefault();
        var id = mark.dataset.id;
        if (findNote(pageKey(), id)) openPopover(pageKey(), id);
        return;
      }
      closePopover();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closePopover();
    });

    // 页面加载完成后应用高亮 (等 KaTeX / Mermaid 渲染完)
    function applyAfterLoad() {
      setTimeout(function () { applyAllMarks(); }, 400);
    }
    if (document.readyState === 'complete') {
      applyAfterLoad();
    } else {
      window.addEventListener('load', applyAfterLoad);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
