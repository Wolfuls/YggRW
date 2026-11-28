'use strict';
(() => {
  const el = id => document.getElementById(id);
  const form = el('migration-form'), status = el('status'), result = el('result'), download = el('download');
  function reset() {
    if (download.hasAttribute('href')) URL.revokeObjectURL(download.href);
    download.removeAttribute('href'); download.hidden = true;
    el('review-list').replaceChildren(); el('copied-list').replaceChildren();
    el('totals').textContent = '';
    el('review').open = false; el('copied').open = false;
    status.textContent = ''; result.hidden = true;
  }
  form.addEventListener('change', reset);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const source = el('source').files[0], target = el('target').files[0], reference = el('reference').files[0];
    if (!source || !target || el('prepare').disabled) return;
    reset(); el('files').disabled = true; el('prepare').disabled = true;
    status.textContent = 'ファイルを読み込んでいます…';
    try {
      const {report, blob} = await CharacterMigration.run(source,target,reference, sheet => {
        status.textContent = '照合中… ' + sheet;
      });
      let count = 0;
      for (const [sheet,entries] of report.copied) {
        count += entries.length;
        const li = document.createElement('li');
        li.textContent = sheet + '（' + entries.length + '件）　' + entries.map(e => e.ref).join('、');
        el('copied-list').appendChild(li);
      }
      const fragment = document.createDocumentFragment();
      for (const item of report.review) {
        const li = document.createElement('li');
        li.textContent = item.sheet + ' ／ ' + item.ref + '　' + item.reason;
        if (item.value !== undefined) {
          const value = document.createElement('span'); value.textContent = item.value; li.appendChild(value);
        }
        fragment.appendChild(li);
      }
      el('review-list').appendChild(fragment);
      el('totals').textContent = '移行 ' + count + ' 件　／　手動確認 ' + report.review.length + ' 件' +
        (!count && !report.review.length ? '。移行する差分はありません。' : '');
      el('copied').hidden = !count; el('review').hidden = !report.review.length;
      el('review').open = !!report.review.length;
      if (blob) {
        download.href = URL.createObjectURL(blob);
        download.download = source.name.replace(/\.xlsx$/i,'') + '_移行済み.xlsx';
        download.hidden = false;
      }
      status.textContent = ''; result.hidden = false; el('result-title').focus();
    } catch (error) {
      status.textContent = error.message || 'ファイルを読み込めませんでした。';
    } finally {
      el('files').disabled = false; el('prepare').disabled = false;
    }
  });
})();
