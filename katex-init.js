// KaTeX auto-render: 渲染 $...$ 行内公式 与 $$...$$ 块级公式
// mdBook 内置 MathJax 不识别 $ 分隔符, 这里用 KaTeX 替代
document.addEventListener('DOMContentLoaded', function () {
  var content = document.getElementById('content');
  if (!content || typeof renderMathInElement === 'undefined') {
    return;
  }
  renderMathInElement(content, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false }
    ],
    throwOnError: false,   // 出错不崩溃, 显示红色错误文本
    ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
  });
});
