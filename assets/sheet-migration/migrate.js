'use strict';
const CharacterMigration = (() => {
  const {Book, normalize, address, position, rectangle} = WorkbookIO;
  const internal = new Set(['リスト','互換リスト','計算用','コピペ用']);
  let bundled;
  async function profiles() {
    if (!bundled) {
      const zip = await JSZip.loadAsync(blankSheetProfiles, {base64:true});
      bundled = JSON.parse(await zip.file('profiles.json').async('string'));
    }
    return bundled;
  }
  const inRect = (r, row, col) => row >= r.row && row < r.row + r.height && col >= r.col && col < r.col + r.width;
  function profileFor(sheet, variants) {
    const choices = variants.filter(v => v.shape === sheet.shape);
    if (!choices.length) return [];
    // Ignore the character's newly filled cells when identifying a blank edition.
    const refs = new Set(choices.flatMap(v => Object.keys(v.cells)));
    let best = Infinity, result = [];
    for (const p of choices) {
      let differences = 0, equal = 0;
      for (const ref of refs) {
        const actual = sheet.value(ref)?.token, initial = p.cells[ref];
        if (actual !== initial) differences++;
        else if (initial) equal++;
      }
      if (equal < Object.keys(p.cells).length * 0.5) continue;
      if (differences < best) { result = []; best = differences; }
      if (differences === best) result.push(p);
    }
    return result;
  }
  function fromBlank(sheet) {
    const cells = Object.create(null);
    for (const [ref, cell] of sheet.cells) if (cell.data) cells[ref] = cell.data.token;
    return {shape:sheet.shape, cells};
  }
  function sameDefault(matches, ref, token) {
    return matches.some(p => p.cells[ref] === token);
  }
  async function fieldMap(book) {
    const tab = await book.sheet('コピペ用'), groups = [{}, {}, {}];
    if (!tab) return groups;
    // The template itself pairs field names with ranges in columns A:B, C:D and E:F.
    for (const row of tab.rows.keys()) {
      for (let group = 0; group < groups.length; group++) {
        const label = tab.value(address(row, group*2+1)), location = tab.value(address(row, group*2+2));
        if (label?.type !== 's' || location?.type !== 's') continue;
        const rect = rectangle(location.value);
        if (rect) groups[group][normalize(label.value)] = rect;
      }
    }
    return groups;
  }
  function bindings(key, oldMap, newMap) {
    const index = key === 'キャラシート' ? 0 : key === '応用技' ? 1 : key.startsWith('クリーチャー') ? 2 : -1;
    if (index < 0) return [];
    return Object.entries(oldMap[index]).map(([label, old]) => ({label, old, next:newMap[index][label]}));
  }
  const dash = text => /^[\s\-‐―ー－–—]+$/u.test(text);
  function staticLabel(sheet, ref, matches) {
    const data = sheet.value(ref);
    return data?.type === 's' && sameDefault(matches,ref,data.token) && !dash(data.value) &&
      data.value.length >= 2 && !/^(RW|バニラ)$/i.test(data.value);
  }
  function matchingContext(a,b,matches, row,col, destRow,destCol) {
    // Nearest printed headings above and to the left also catch reordering within identical grids.
    let hits = 0, misses = 0;
    for (const [dr,dc] of [[-1,0],[0,-1],[-1,-1]]) {
      for (let step=1; step<=7; step++) {
        const r = row+dr*step, c = col+dc*step, rr = destRow+dr*step, cc = destCol+dc*step;
        if (Math.min(r,c,rr,cc)<1) break;
        const ref = address(r,c);
        if (!staticLabel(a,ref,matches)) continue;
        if (b.value(address(rr,cc))?.token === a.value(ref).token) hits++; else misses++;
        break;
      }
    }
    return {hits, misses};
  }
  function findDestination(a,b,ref,fields,matches) {
    const [row,col] = position(ref);
    const field = fields.find(f => inRect(f.old,row,col));
    let rr = row, cc = col;
    if (field?.next) {
      if (field.old.width !== field.next.width || field.old.height !== field.next.height)
        return {reason:'対応する入力欄の大きさが変わりました。'};
      rr += field.next.row-field.old.row; cc += field.next.col-field.old.col;
    } else if (a.shape !== b.shape || field) {
      return {reason:'新版で同じ入力欄を特定できません。'};
    }
    const src = a.merge(row,col), dst = b.merge(rr,cc);
    if ((src && (src.row !== row || src.col !== col)) || (dst && (dst.row !== rr || dst.col !== cc)) ||
        (src?.height || 1) !== (dst?.height || 1) || (src?.width || 1) !== (dst?.width || 1))
      return {reason:'セルの結合範囲が変わりました。'};
    const target = address(rr,cc);
    if (!b.cells.has(target) && !dst && !field && !b.validateAt(rr,cc))
      return {reason:'新版に対応するセル枠がありません。'};
    const {hits,misses} = matchingContext(a,b,matches,row,col,rr,cc);
    if ((!hits && (misses || a.shape !== b.shape)) || (misses > hits && (a.shape !== b.shape || rr !== row || cc !== col)))
      return {reason:'周辺の見出しが変わり、入力先を確認できません。'};
    return {ref:target, row:rr, col:cc, field};
  }
  function writableDefault(a,b,ref,where,initial,targetInitial) {
    const val = b.value(where.ref);
    if (!val) return true;
    const verified = sameDefault(targetInitial,where.ref,val.token) || sameDefault(initial,ref,val.token);
    if (!verified) return false;
    if (b.validateAt(where.row,where.col) || (val.type === 's' && dash(val.value))) return true;
    if (val.type === 'n' || val.type === 'b') return true;
    return !!where.field && (where.field.old.width * where.field.old.height === 1 || /^※この行/.test(val.value));
  }
  function listReference(text) {
    const m = /^(?:'((?:[^']|'')+)'|([^!(),]+))!(\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?)$/.exec(text);
    return m && {sheet:normalize((m[1] || m[2]).replace(/''/g,"'")), rect:rectangle(m[3])};
  }
  async function lookup(book, text) {
    const ref = listReference(text);
    if (!ref?.rect || ref.rect.width * ref.rect.height !== 1) return undefined;
    const tab = await book.sheet(ref.sheet);
    if (!tab) return undefined;
    const cell = tab.value(address(ref.rect.row,ref.rect.col));
    return cell?.type === 'f' ? undefined : cell?.value || '';
  }
  async function choiceValue(book, cell) {
    if (cell?.type !== 'f') return cell?.value || '';
    // Only resolve the two lookup forms used by the compatibility lists.
    // Other Excel expressions are left to the spreadsheet application.
    let formula = cell.value;
    const mode = /^IF\(([^(),=]+)="RW",(IF\([^()]+\)|""),(IF\([^()]+\)|"")\)$/i.exec(formula);
    if (mode) {
      const environment = await lookup(book,mode[1]);
      if (environment === undefined) return undefined;
      formula = environment === 'RW' ? mode[2] : mode[3];
      if (formula === '""') return '';
    }
    const direct = /^IF\(([^(),=]+)="","",\1\)$/i.exec(formula);
    return direct ? lookup(book,direct[1]) : undefined;
  }
  async function allowedChoices(book, rule) {
    const expr = rule.replace(/^=/,'').trim();
    if (/^"[^"]*"$/.test(expr)) return new Set(expr.slice(1,-1).split(',').map(s => s.toLowerCase()));
    const ref = listReference(book.names.get(expr) || expr);
    if (!ref?.rect || ref.rect.width * ref.rect.height > 10000) return null;
    const list = await book.sheet(ref.sheet);
    if (!list) return null;
    const values = new Set(), rect = ref.rect;
    for (let r=rect.row; r<rect.row+rect.height; r++) for (let c=rect.col; c<rect.col+rect.width; c++) {
      const v = await choiceValue(book,list.value(address(r,c)));
      if (v === undefined) return null;
      if (v !== '') values.add(v.toLowerCase());
    }
    return values;
  }
  async function transferCells(a,b,sourceInitial,targetInitial,fields,report) {
    const lists = new Map();
    for (const [ref,cell] of a.cells) {
      const data = cell.data;
      if (!data || sameDefault(sourceInitial,ref,data.token)) continue;
      if (data.type === 'f') { report.skip(a,ref,'旧版に手入力した数式です。', '=' + data.value); continue; }
      const where = findDestination(a,b,ref,fields,sourceInitial);
      if (where.reason) { report.skip(a,ref,where.reason,data.value); continue; }
      const current = b.value(where.ref);
      if (current?.type === data.type && current.value === data.value) continue;
      if (current?.type === 'f' || b.formulaRanges.some(r => inRect(r,where.row,where.col))) {
        report.skip(a,ref,'新版では計算欄です。',data.value); continue;
      }
      if (!['s','n','b','d'].includes(data.type)) { report.skip(a,ref,'セルにエラーまたは非対応の値があります。',data.value); continue; }
      if (!writableDefault(a,b,ref,where,sourceInitial,targetInitial)) {
        report.skip(a,ref,'新版の見出しまたは記入済みの値を保護しました。',data.value); continue;
      }
      const list = b.validations.find(r => r.type === 'list' && inRect(r,where.row,where.col));
      if (list?.formula) {
        if (!lists.has(list.formula)) lists.set(list.formula,await allowedChoices(b.book,list.formula));
        const choices = lists.get(list.formula);
        if (choices && !choices.has(data.value.toLowerCase())) {
          report.skip(a,ref,'新版のプルダウンに同じ選択肢がありません。',data.value); continue;
        }
      }
      b.write(where.ref,data);
      report.add(a,ref === where.ref ? ref : ref + ' → ' + where.ref,'セル');
    }
  }
  class Report {
    constructor() { this.copied = new Map(); this.review = []; }
    add(sheet,ref,kind) {
      if (!this.copied.has(sheet.name)) this.copied.set(sheet.name, []);
      this.copied.get(sheet.name).push({ref,kind});
    }
    skip(sheet,ref,reason,value) { this.review.push({sheet:sheet.name,ref,reason,value}); }
  }
  async function run(sourceFile,targetFile,referenceFile,onProgress) {
    const open = async (file,role) => {
      try { return await Book.open(file); }
      catch (err) { throw Error(role + 'を読み込めません。' + (err.message.includes('zip') ? '未暗号化の .xlsx を選んでください。' : err.message)); }
    };
    const data = await profiles(), report = new Report();
    const [oldBook,newBook,blankBook] = await Promise.all([open(sourceFile,'旧版A'),open(targetFile,'新版B'),
      referenceFile ? open(referenceFile,'旧版Aの空シート') : null]);
    if (oldBook.date1904 !== newBook.date1904) throw Error('AとBの日付システム（1900年／1904年）が異なります。日付システムを揃えてください。');
    const [oldMap,newMap] = await Promise.all([fieldMap(oldBook),fieldMap(newBook)]);
    // Resolve rule-dependent selections after migrating the main sheet's environment.
    const order = ['キャラシート', ...Array.from(oldBook.tabs.keys()).filter(k => k !== 'キャラシート')];
    for (const key of order) {
      const tab = oldBook.tabs.get(key);
      if (internal.has(key)) continue;
      if (tab.hidden && !data.sheets[key]) continue;
      if (!newBook.tabs.has(key)) { report.skip(tab,'シート全体','新版に同名のシートがありません。'); continue; }
      onProgress(tab.name);
      const [a,b,base] = await Promise.all([oldBook.sheet(key),newBook.sheet(key),blankBook?.sheet(key)]);
      const choices = data.sheets[key] || [];
      const initial = base ? profileFor(a,[fromBlank(base)]) : profileFor(a,choices);
      if (!initial.length) {
        report.skip(tab,'シート全体',base ? '指定した旧版の空シートと配置・見出しが一致しません。' : 'この版の入力欄は未登録です。旧版Aと同じ版の空シートを指定して再確認してください。');
        continue;
      }
      const targetInitial = profileFor(b,choices);
      await transferCells(a,b,initial,targetInitial,bindings(key,oldMap,newMap),report);
      await SheetObjects.transfer(a,b,base,data.stockImages,report);
    }
    return {report, blob:report.copied.size ? await newBook.save() : null};
  }
  return {run};
})();
