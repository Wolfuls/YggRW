'use strict';

(() => {
  const omitted = '.rw-entry-copy, .rw-entry-update, .source-separator, [hidden], [aria-hidden="true"]';
  const blocks = new Set(['DIV', 'SECTION', 'P', 'DL', 'UL', 'OL', 'LI', 'H2', 'H3', 'H4']);

  function plainText(element) {
    const parts = [];
    function append(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.data.replace(/[ \t\r\n\f]+/g, ' '));
        return;
      }
      if (!(node instanceof Element) || node.matches(omitted)) return;
      if (node.matches('.rw-timing-icons')) {
        const timing = Array.from(node.querySelectorAll('.rw-timing-icon:not([aria-hidden="true"]) img[alt]'), image => image.alt).filter(Boolean);
        if (timing.length) parts.push('　' + timing.join(' / '));
        return;
      }

      const tag = node.tagName;
      if (tag === 'BR' || tag === 'HR') {
        parts.push('\n');
        return;
      }
      if (tag === 'IMG') {
        parts.push(node.alt);
        return;
      }
      if (blocks.has(tag) || tag === 'DT') parts.push('\n');
      if (tag === 'LI') parts.push('・');
      node.childNodes.forEach(append);
      if (tag === 'DT') parts.push('　');
      if (blocks.has(tag) || tag === 'DD') parts.push('\n');
    }

    append(element);
    return parts.join('').split('\n')
      .map(line => line.replace(/ *　 */g, '　').replace(/ {2,}/g, ' ').trim())
      .filter(Boolean).join('\n');
  }

  async function copy(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Local copies of the rulebook can be opened in a browser without Clipboard API access.
    }

    const previousFocus = document.activeElement;
    const field = document.createElement('textarea');
    field.className = 'rw-copy-buffer';
    field.value = text;
    field.readOnly = true;
    field.tabIndex = -1;
    document.body.append(field);
    field.focus({preventScroll: true});
    field.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      field.remove();
      previousFocus?.focus({preventScroll: true});
    }
  }

  for (const catalogue of document.querySelectorAll('[data-copy-catalogue]')) {
    const status = document.createElement('span');
    status.className = 'rw-copy-status';
    status.setAttribute('role', 'status');
    catalogue.append(status);

    for (const item of catalogue.querySelectorAll('.rw-catalogue-entry, tr[data-copy-entry]')) {
      const name = item.cells?.[0] ?? item.querySelector('.rw-catalogue-name');
      const body = item.cells?.[1] ?? item.querySelector('.rw-catalogue-body');
      const title = name?.querySelector('.rw-entry-title') ?? name?.querySelector('strong');
      if (!title || !body) continue;
      const label = plainText(title);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rw-entry-copy';
      button.textContent = 'コピー';
      button.setAttribute('aria-label', label + 'をコピー');
      name.append(button);

      let reset;
      button.addEventListener('click', async () => {
        const text = '【' + catalogue.dataset.copyCatalogue + '】' + plainText(name) + '\n\n' + plainText(body);
        const copied = await copy(text);
        button.textContent = copied ? 'コピー済み' : 'コピー失敗';
        button.classList.toggle('is-copied', copied);
        status.textContent = copied ? label + 'をコピーしました。' : label + 'をコピーできませんでした。';
        clearTimeout(reset);
        reset = setTimeout(() => {
          button.textContent = 'コピー';
          button.classList.remove('is-copied');
        }, 2000);
      });
    }
  }
})();
