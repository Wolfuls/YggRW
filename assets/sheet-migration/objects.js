/* Portraits are shared media in the blank sheet. Give each imported portrait its own part. */
'use strict';
const SheetObjects = (() => {
  const {all, first, child, hash, relNS, relPath} = WorkbookIO;
  async function pictures(sheet) {
    const list = [];
    for (const drawing of (await sheet.book.relations(sheet.path)).values()) {
      if (drawing.kind !== 'drawing') continue;
      const rels = await sheet.book.relations(drawing.path);
      for (const pic of all(await sheet.book.xml(drawing.path), 'pic')) {
        const blip = first(pic,'blip');
        const rel = rels.get(blip?.getAttributeNS(relNS, 'embed'));
        if (rel?.kind !== 'image') { list.push({}); continue; }
        const bytes = await sheet.book.zip.file(rel.path).async('uint8array');
        list.push({bytes, token: hash(bytes), drawing: drawing.path, rel});
      }
    }
    return list;
  }
  function relative(from, to) {
    const src = from.split('/').slice(0,-1), dst = to.split('/');
    while (src.length && dst.length && src[0] === dst[0]) { src.shift(); dst.shift(); }
    return '../'.repeat(src.length) + dst.join('/');
  }
  async function migratePicture(a, b, blank, stock, report) {
    const defaults = new Set(stock);
    if (blank) for (const img of await pictures(blank)) defaults.add(img.token);
    const personal = (await pictures(a)).filter(pic => !pic.token || !defaults.has(pic.token));
    if (!personal.length) return;
    const targets = await pictures(b);
    const src = personal[0], dest = targets[0];
    if (src.token && targets.some(pic => pic.token === src.token) && personal.length === 1) return;
    if (personal.length !== 1 || targets.length !== 1 || !dest.rel || !defaults.has(dest.token) || !src.bytes) {
      report.skip(a, '立ち絵', '画像と新版の立ち絵枠を一対一で対応できません。'); return;
    }
    const bytes = src.bytes;
    let format;
    if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) format = 'png';
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) format = 'jpeg';
    if (!format) { report.skip(a, '立ち絵', 'PNG・JPEG以外の画像です。'); return; }
    const folder = dest.rel.path.slice(0, dest.rel.path.lastIndexOf('/') + 1);
    let part, serial = 0;
    do { part = folder + 'rw-portrait-' + (++serial) + '.' + format; } while (b.book.zip.file(part));
    b.book.zip.file(part, bytes);
    dest.rel.el.setAttribute('Target', relative(dest.drawing, part));
    b.book.dirty.add(relPath(dest.drawing));
    const types = await b.book.xml('[Content_Types].xml');
    if (!all(types,'Default').some(el => el.getAttribute('Extension') === format && el.getAttribute('ContentType') === 'image/' + format)) {
      const entry = types.createElementNS(types.documentElement.namespaceURI,'Override');
      entry.setAttribute('PartName','/' + part);
      entry.setAttribute('ContentType','image/' + format);
      types.documentElement.appendChild(entry); b.book.dirty.add('[Content_Types].xml');
    }
    report.add(a, '立ち絵', '画像');
  }
  async function checkboxes(sheet) {
    const rels = await sheet.book.relations(sheet.path), boxes = new Map(), byShape = new Map();
    for (const el of all(sheet.doc, 'control')) {
      const rel = rels.get(el.getAttributeNS(relNS,'id'));
      if (rel?.kind !== 'ctrlProp') continue;
      const prop = (await sheet.book.xml(rel.path)).documentElement;
      if (prop.getAttribute('objectType') !== 'CheckBox') continue;
      const name = first(el,'controlPr')?.getAttribute('altText') || el.getAttribute('name');
      const box = {prop, propPath: rel.path, state: prop.getAttribute('checked') || 'Unchecked'};
      boxes.set(name, box); byShape.set(el.getAttribute('shapeId'), box);
    }
    for (const rel of rels.values()) {
      if (rel.kind !== 'vmlDrawing') continue;
      for (const shape of all(await sheet.book.xml(rel.path), 'shape')) {
        const data = first(shape, 'ClientData');
        if (data?.getAttribute('ObjectType')?.toLowerCase() !== 'checkbox') continue;
        const id = shape.getAttributeNS('urn:schemas-microsoft-com:office:office','spid') || shape.getAttribute('id') || '';
        const name = shape.getAttribute('alt') || first(shape,'textbox')?.textContent.trim() || id;
        const box = byShape.get(id.replace('_x0000_s','')) || boxes.get(name) || {};
        const checked = child(data,'Checked')?.textContent.trim();
        if (checked !== undefined || !box.state) box.state = ({'1':'Checked','2':'Mixed','0':'Unchecked'})[checked] || 'Unchecked';
        box.vml = data; box.vmlPath = rel.path;
        if (!boxes.has(name) && !byShape.has(id.replace('_x0000_s',''))) boxes.set(name, box);
      }
    }
    return boxes;
  }
  async function migrateBoxes(a, b, blank, report) {
    const source = await checkboxes(a);
    if (!source.size) return;
    const target = await checkboxes(b), base = blank ? await checkboxes(blank) : new Map();
    for (const [name, old] of source) {
      if (old.state === (base.get(name)?.state || 'Unchecked')) continue;
      const box = target.get(name);
      if (!box) { report.skip(a, name, '同じ名前のチェック欄が新版にありません。'); continue; }
      if (box.state === old.state) continue;
      if (box.prop) {
        box.prop.setAttribute('checked', old.state); b.book.dirty.add(box.propPath);
      }
      if (box.vml) {
        let checked = child(box.vml, 'Checked');
        if (!checked) {
          checked = box.vml.ownerDocument.createElementNS(box.vml.namespaceURI, 'x:Checked');
          box.vml.appendChild(checked);
        }
        checked.textContent = ({Checked:'1', Mixed:'2', Unchecked:'0'})[old.state];
        b.book.dirty.add(box.vmlPath);
      }
      report.add(a, name, 'チェック欄');
    }
  }
  async function transfer(a, b, blank, stock, report) {
    if (a.key === 'キャラシート' || a.key.startsWith('クリーチャー')) {
      await migratePicture(a, b, blank, stock, report);
      await migrateBoxes(a, b, blank, report);
    }
  }
  return {transfer};
})();
