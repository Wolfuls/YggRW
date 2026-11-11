"""Check local HTML/CSS links against the known pre-existing issues.
Run from any directory: python tools/check_links.py
"""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import html
import json
import posixpath
import re
import sys

def decode(raw):
    if raw.startswith(b'\xef\xbb\xbf'):
        return raw.decode('utf-8-sig'), 'utf-8-sig'
    for encoding in ['utf-8', 'cp932']:
        try:
            return raw.decode(encoding), encoding
        except UnicodeDecodeError:
            pass
    # Byte-preserving fallback for old downloaded documents.
    return raw.decode('latin-1'), 'latin-1'

def resolve_url(base, value):
    value = html.unescape(value).strip()
    if not value or value.startswith('//'):
        return None
    try:
        parts = urlsplit(value)
    except ValueError:
        return None
    if parts.scheme or parts.netloc:
        return None
    path = unquote(parts.path).replace('\\', '/')
    if path.startswith('/'):
        if path.startswith('/YggRW/'):
            path = path[len('/YggRW/'):]
        else:
            path = path.lstrip('/')
        target = posixpath.normpath(path)
    elif path:
        target = posixpath.normpath(posixpath.join(posixpath.dirname(base), path))
    else:
        target = base
    return target, unquote(parts.fragment)

CSS_URL = re.compile(r'''(?P<lead>url\(\s*)(?P<q>["']?)(?P<v>[^\s)"']+)(?P=q)(?P<tail>\s*\))''', re.I)

class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.refs = []
        self.ids = set()
        self.text = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        for name in ['id', 'name']:
            if attrs.get(name):
                self.ids.add(attrs[name])
        for name in ['href', 'src', 'poster', 'background', 'action', 'data-src']:
            if attrs.get(name):
                self.refs.append((name, attrs[name]))
        if tag == 'meta' and attrs.get('http-equiv', '').lower() == 'refresh':
            m = re.search(r'url\s*=\s*(.*)', attrs.get('content', ''), re.I)
            if m:
                self.refs.append(('refresh', m[1]))
        if attrs.get('style'):
            self.refs.extend(('css', m['v']) for m in CSS_URL.finditer(attrs['style']))
    def handle_data(self, value):
        self.text.append(value)

def snapshot(root):
    return {p.relative_to(root).as_posix(): p for p in root.rglob('*')
            if p.is_file() and '.git' not in p.relative_to(root).parts}

def inspect(root):
    files = snapshot(root)
    pages = {}
    refs = []
    for name, path in files.items():
        if path.suffix.lower() in ('.html', '.htm'):
            text, _ = decode(path.read_bytes())
            page = Page()
            page.feed(text)
            pages[name] = page
            refs.extend((name, kind, value) for kind, value in page.refs)
        elif path.suffix.lower() == '.css':
            text, _ = decode(path.read_bytes())
            refs.extend((name, 'css', m['v']) for m in CSS_URL.finditer(text))
    missing = set()
    missing_anchor = set()
    for source, kind, value in refs:
        dest = resolve_url(source, value)
        if not dest:
            continue
        target, fragment = dest
        if target not in files and (root / target).is_dir():
            target = target.rstrip('/') + '/index.html'
        if target not in files:
            missing.add((source, kind, target, fragment))
        elif fragment and target in pages and fragment not in pages[target].ids:
            missing_anchor.add((source, target, fragment))
    return {'files': files, 'pages': pages, 'refs': refs, 'missing': missing, 'anchors': missing_anchor}

def main():
    root = Path(__file__).resolve().parents[1]
    result = inspect(root)
    baseline = json.loads((root / 'records/link-baseline.json').read_text(encoding='utf-8'))
    known_missing = {tuple(item) for item in baseline['missing']}
    known_anchors = {tuple(item) for item in baseline['anchors']}
    new_missing = sorted(result['missing'] - known_missing)
    new_anchors = sorted(result['anchors'] - known_anchors)
    print(f"Checked {len(result['pages'])} HTML pages and {len(result['refs'])} references.")
    print(f"Existing issues: {len(result['missing'] & known_missing)} missing files, {len(result['anchors'] & known_anchors)} missing anchors.")
    for item in new_missing:
        print('NEW missing file:', item)
    for item in new_anchors:
        print('NEW missing anchor:', item)
    print(f"New issues: {len(new_missing) + len(new_anchors)}")
    return bool(new_missing or new_anchors)

if __name__ == '__main__':
    sys.exit(main())
