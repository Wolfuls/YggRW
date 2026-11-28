/* SpreadsheetML helpers. The output always starts as the complete target package. */
'use strict';
const WorkbookIO = (() => {
  const relNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const xmlNS = 'http://www.w3.org/XML/1998/namespace';
  const encoder = new TextEncoder();
  const normalize = name => name.normalize('NFKC').replace(/\s/g, '');
  const all = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
  const first = (node, name) => node && node.getElementsByTagNameNS('*', name)[0];
  function child(node, name) {
    for (let el = node && node.firstElementChild; el; el = el.nextElementSibling)
      if (el.localName === name) return el;
    return null;
  }
  function hash(bytes) {
    let value = 2166136261;
    for (const byte of bytes) value = Math.imul(value ^ byte, 16777619);
    return String(value >>> 0);
  }
  const textHash = text => hash(encoder.encode(text));
  function richText(container) {
    let value = '';
    for (let el = container && container.firstElementChild; el; el = el.nextElementSibling) {
      if (el.localName === 't') value += el.textContent;
      if (el.localName === 'r') value += child(el, 't')?.textContent || '';
    }
    return value;
  }
  function position(ref) {
    const match = /^([A-Z]+)([1-9]\d*)$/.exec(ref);
    if (!match) return null;
    let col = 0;
    for (const ch of match[1]) col = col * 26 + ch.charCodeAt(0) - 64;
    return [Number(match[2]), col];
  }
  function address(row, col) {
    let letters = '';
    while (col > 0) {
      col--;
      letters = String.fromCharCode(65 + col % 26) + letters;
      col = Math.floor(col / 26);
    }
    return letters + row;
  }
  function rectangle(range) {
    const refs = range.normalize('NFKC').trim().replace(/\$/g, '').toUpperCase().split(':');
    const a = position(refs[0]), b = position(refs[1] || refs[0]);
    if (!a || !b || refs.length > 2 || b[0] < a[0] || b[1] < a[1]) return null;
    return {row: a[0], col: a[1], height: b[0]-a[0]+1, width: b[1]-a[1]+1};
  }
  function resolve(part, target) {
    const parts = target.startsWith('/') ? [] : part.split('/').slice(0, -1);
    for (const segment of target.split('/')) {
      if (segment === '..') parts.pop();
      else if (segment && segment !== '.') parts.push(segment);
    }
    return parts.join('/');
  }
  function relPath(part) {
    const split = part.lastIndexOf('/') + 1;
    return part.slice(0, split) + '_rels/' + part.slice(split) + '.rels';
  }
  function readCell(el, strings) {
    const formula = child(el, 'f');
    if (formula) return {type: 'f', value: formula.textContent, token: 'f'};
    let type = el.getAttribute('t') || 'n';
    let value = child(el, 'v')?.textContent || '';
    if (type === 's') value = value ? strings[Number(value)] : '';
    if (type === 'inlineStr') value = richText(child(el, 'is'));
    if (['s','str','inlineStr'].includes(type)) type = 's';
    if (value === undefined) throw Error('共有文字列を読み取れないセルがあります。');
    if (!value) return null;
    const token = type === 's' ? 's' + textHash(value) : type + (type === 'n' ? Number(value) : value);
    return {type, value, token};
  }
  class Sheet {
    constructor(book, tab, doc) {
      Object.assign(this, tab, {book, doc, cells: new Map(), rows: new Map(), merges: new Map()});
      this.data = first(doc, 'sheetData');
      for (const row of this.data.children) {
        this.rows.set(Number(row.getAttribute('r')), row);
        for (const cell of row.children) {
          if (cell.localName !== 'c') continue;
          this.cells.set(cell.getAttribute('r'), {el: cell, data: readCell(cell, book.strings)});
        }
      }
      const ranges = all(doc, 'mergeCell').map(el => el.getAttribute('ref'));
      this.shape = textHash(ranges.sort().join(','));
      for (const range of ranges) {
        const rect = rectangle(range);
        for (let i = rect.row; i < rect.row + rect.height; i++) {
          if (!this.merges.has(i)) this.merges.set(i, []);
          this.merges.get(i).push(rect);
        }
      }
      this.validations = all(doc, 'dataValidation').flatMap(el => {
        const refs = el.getAttribute('sqref') || first(el, 'sqref')?.textContent || '';
        const formula = first(el,'formula1')?.textContent || '';
        return refs.trim().split(/\s+/).map(rectangle).filter(Boolean).map(r => ({...r, type:el.getAttribute('type'), formula}));
      });
      this.formulaRanges = all(this.data,'f').filter(f => ['array','dataTable'].includes(f.getAttribute('t')) && f.hasAttribute('ref'))
        .map(f => rectangle(f.getAttribute('ref'))).filter(Boolean);
    }
    value(ref) { return this.cells.get(ref)?.data; }
    merge(row, col) {
      return (this.merges.get(row) || []).find(r => col >= r.col && col < r.col + r.width);
    }
    validateAt(row, col) {
      return this.validations.some(r => row >= r.row && row < r.row + r.height && col >= r.col && col < r.col + r.width);
    }
    write(ref, data) {
      const [row, col] = position(ref);
      const ns = this.doc.documentElement.namespaceURI;
      let cell = this.cells.get(ref)?.el;
      if (!cell) {
        let line = this.rows.get(row);
        if (!line) {
          line = this.doc.createElementNS(ns, 'row');
          line.setAttribute('r', String(row));
          const next = Array.from(this.data.children).find(r => Number(r.getAttribute('r')) > row);
          this.data.insertBefore(line, next || null);
          this.rows.set(row, line);
        }
        cell = this.doc.createElementNS(ns, 'c');
        cell.setAttribute('r', ref);
        const next = Array.from(line.children).find(c => c.localName !== 'c' || position(c.getAttribute('r'))[1] > col);
        line.insertBefore(cell, next || null);
      }
      for (const old of Array.from(cell.children)) if (['f','v','is'].includes(old.localName)) old.remove();
      cell.removeAttribute('t');
      if (data.type === 's') {
        cell.setAttribute('t', 'inlineStr');
        const container = this.doc.createElementNS(ns, 'is');
        const text = this.doc.createElementNS(ns, 't');
        text.setAttributeNS(xmlNS, 'xml:space', 'preserve');
        text.textContent = data.value;
        container.appendChild(text);
        cell.insertBefore(container, cell.firstElementChild);
      } else {
        if (data.type !== 'n') cell.setAttribute('t', data.type);
        const value = this.doc.createElementNS(ns, 'v');
        value.textContent = data.value;
        cell.insertBefore(value, cell.firstElementChild);
      }
      this.cells.set(ref, {el: cell, data});
      this.book.dirty.add(this.path);
    }
  }
  class Book {
    constructor(zip) {
      this.zip = zip;
      this.docs = new Map(); this.dirty = new Set(); this.tabs = new Map(); this.sheets = new Map();
      this.names = new Map();
    }
    static async open(file) {
      if (!/\.xlsx$/i.test(file.name)) throw Error('拡張子が .xlsx のPC用キャラシートを選んでください。');
      const book = new Book(await JSZip.loadAsync(await file.arrayBuffer()));
      const rootRels = await book.relations('');
      book.path = Array.from(rootRels.values()).find(r => r.kind === 'officeDocument')?.path;
      if (!book.path) throw Error('Excelのブックを読み取れません。');
      const doc = await book.xml(book.path);
      for (const entry of all(doc,'definedName')) {
        if (!entry.hasAttribute('localSheetId')) book.names.set(entry.getAttribute('name'),entry.textContent);
      }
      const relationships = await book.relations(book.path);
      const stringPart = Array.from(relationships.values()).find(r => r.kind === 'sharedStrings');
      book.strings = stringPart ? all(await book.xml(stringPart.path), 'si').map(richText) : [];
      book.date1904 = ['1','true'].includes(first(doc,'workbookPr')?.getAttribute('date1904'));
      for (const el of all(doc, 'sheet')) {
        const link = relationships.get(el.getAttributeNS(relNS, 'id'));
        if (link?.kind !== 'worksheet') continue;
        const name = el.getAttribute('name'), key = normalize(name);
        if (book.tabs.has(key)) throw Error('同名のシートを区別できません。');
        book.tabs.set(key, {name, key, path: link.path, hidden: /hidden/i.test(el.getAttribute('state') || '')});
      }
      if (!book.tabs.has('キャラシート') || !book.tabs.has('応用技')) throw Error('RWのPC用キャラシートを選んでください。');
      const main = await book.sheet('キャラシート');
      const labels = new Set(Array.from(main.cells.values(), c => c.data?.type === 's' ? normalize(c.data.value) : ''));
      if (labels.has('NPC特性') || !labels.has('キャラクター名') || !labels.has('身体タイプ'))
        throw Error('PC用キャラシートを確認できません。NPCシートは対象外です。');
      return book;
    }
    async xml(path) {
      if (!this.docs.has(path)) {
        const part = this.zip.file(path);
        if (!part) throw Error('ブック内のファイルが見つかりません（' + path + '）。');
        const doc = new DOMParser().parseFromString(await part.async('string'), 'application/xml');
        if (first(doc, 'parsererror')) throw Error('ブックのXMLを読み取れません（' + path + '）。');
        this.docs.set(path, doc);
      }
      return this.docs.get(path);
    }
    async relations(path) {
      const part = relPath(path), result = new Map();
      if (!this.zip.file(part)) return result;
      for (const el of (await this.xml(part)).documentElement.children) {
        if (el.getAttribute('TargetMode') === 'External') continue;
        result.set(el.getAttribute('Id'), {el, kind: el.getAttribute('Type').split('/').pop(), path: resolve(path, el.getAttribute('Target'))});
      }
      return result;
    }
    async sheet(key) {
      const tab = this.tabs.get(key);
      if (!tab) return null;
      if (!this.sheets.has(key)) this.sheets.set(key, new Sheet(this, tab, await this.xml(tab.path)));
      return this.sheets.get(key);
    }
    async save() {
      // Calc can reuse some cached results even when fullCalcOnLoad is set.
      // A blank template's cached results no longer describe the imported character.
      for (const tab of this.tabs.values()) {
        const doc = await this.xml(tab.path);
        for (const formula of all(first(doc,'sheetData'),'f')) {
          const cell = formula.parentElement;
          const cached = child(cell,'v');
          if (cached) {
            cached.remove();
            cell.removeAttribute('t');
            this.dirty.add(tab.path);
          }
        }
      }
      const workbook = await this.xml(this.path);
      let calc = first(workbook, 'calcPr');
      if (!calc) {
        calc = workbook.createElementNS(workbook.documentElement.namespaceURI, 'calcPr');
        const following = ['oleSize','customWorkbookViews','pivotCaches','smartTagPr','smartTagTypes','webPublishing','fileRecoveryPr','webPublishObjects','extLst'];
        const next = Array.from(workbook.documentElement.children).find(el => following.includes(el.localName));
        workbook.documentElement.insertBefore(calc, next || null);
      }
      calc.setAttribute('fullCalcOnLoad','1');
      calc.setAttribute('forceFullCalc','1');
      calc.setAttribute('calcCompleted','0');
      this.dirty.add(this.path);
      const serializer = new XMLSerializer();
      for (const part of this.dirty) this.zip.file(part, serializer.serializeToString(await this.xml(part)));
      return this.zip.generateAsync({type:'blob', compression:'DEFLATE', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    }
  }
  return {Book, normalize, position, address, rectangle, hash, first, child, all, relNS, relPath};
})();
