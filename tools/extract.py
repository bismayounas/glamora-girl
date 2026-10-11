#!/usr/bin/env python3
"""One-off extractor: converts the single-file blog HTML into
   content/articles/*.md + static/images/* + templates/base.html
   Run from the project root:  python3 tools/extract.py
"""
import re, os, base64, html as htmllib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = '/home/hatch/workspace/your_files/girls-fashion-blog/girls-fashion-blog.html'

def slugify(text):
    s = text.lower()
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return re.sub(r'-+', '-', s)

def yq(value):
    """YAML double-quoted scalar."""
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'

def md_paragraphs(body_html):
    paras = re.findall(r'<p>(.*?)</p>', body_html, re.S)
    out = []
    for p in paras:
        t = htmllib.unescape(re.sub(r'<[^>]+>', '', p))
        t = re.sub(r'[ \t]+', ' ', t).strip()
        out.append(t)
    return out

def main():
    html = open(SRC, encoding='utf-8').read()

    img_dir = os.path.join(ROOT, 'static', 'images')
    art_dir = os.path.join(ROOT, 'content', 'articles')
    os.makedirs(img_dir, exist_ok=True)
    os.makedirs(art_dir, exist_ok=True)

    # ---------- 1. stories ----------
    stories = re.findall(r'<article class="story">(.*?)</article>', html, re.S)
    assert len(stories) == 3, f"expected 3 stories, got {len(stories)}"
    story_infos = []
    for i, s in enumerate(stories, 1):
        m = re.search(r'<img\s+src="data:image/([^;]+);base64,([A-Za-z0-9+/=]+)"\s+alt="([^"]*)"', s)
        fmt, b64, alt = m.group(1), m.group(2), htmllib.unescape(m.group(3))
        meta = htmllib.unescape(re.search(r'<p class="story-meta">(.*?)</p>', s, re.S).group(1).strip())
        title = htmllib.unescape(re.search(r'<h3>(.*?)</h3>', s, re.S).group(1).strip())
        excerpt = htmllib.unescape(re.search(r'</h3>\s*<p>(.*?)</p>', s, re.S).group(1).strip())
        slug = slugify(title)
        ext = 'jpg' if fmt == 'jpeg' else fmt
        fname = f'{slug}.{ext}'
        open(os.path.join(img_dir, fname), 'wb').write(base64.b64decode(b64))
        story_infos.append(dict(slug=slug, title=title, meta=meta, excerpt=excerpt,
                                image=f'/images/{fname}', alt=alt, order=i))
        print(f'story {i}: {title[:50]!r} -> {fname} ({len(b64)*3//4} bytes)')

    # ---------- 2. journal notes ----------
    rows = re.findall(r'<details class="article-row">(.*?)</details>', html, re.S)
    assert len(rows) == 10, f"expected 10 journal rows, got {len(rows)}"
    note_infos = []
    for i, r in enumerate(rows, 1):
        summ = re.search(r'<summary>(.*?)</summary>', r, re.S).group(1)
        no = re.search(r'<span class="article-no">(.*?)</span>', summ).group(1).strip()
        title = htmllib.unescape(re.search(r'<h3>(.*?)</h3>', summ, re.S).group(1).strip())
        excerpt = htmllib.unescape(re.search(r'<p class="article-summary">(.*?)</p>', summ, re.S).group(1).strip())
        body_html = re.search(r'<div class="article-body">(.*?)</div>', r, re.S).group(1)
        paras = md_paragraphs(body_html)
        assert paras, f"note {i} has no paragraphs"
        slug = f'{i:02d}-' + slugify(title)
        note_infos.append(dict(slug=slug, title=title, excerpt=excerpt, paras=paras,
                               no=no, order=i))
        print(f'note {i}: {title[:50]!r} ({len(paras)} paras)')

    # ---------- 3. hero image ----------
    m = re.search(r'<img\s+src="data:image/([^;]+);base64,([A-Za-z0-9+/=]+)"\s+alt="Two women in bold street-style looks during fashion week"',
                  html)
    assert m, "hero image not found"
    fmt, b64 = m.group(1), m.group(2)
    ext = 'jpg' if fmt == 'jpeg' else fmt
    open(os.path.join(img_dir, f'hero.{ext}'), 'wb').write(base64.b64decode(b64))
    print(f'hero image -> hero.{ext} ({len(b64)*3//4} bytes)')

    # ---------- 4. markdown files ----------
    def write_md(fname, fm, body_paras):
        lines = ['---']
        for k, v in fm:
            lines.append(f'{k}: {yq(v)}' if isinstance(v, str) else f'{k}: {v}')
        lines += ['---', '']
        lines += ['\n\n'.join(body_paras), '']
        open(os.path.join(art_dir, fname), 'w', encoding='utf-8').write('\n'.join(lines))

    for i, s in enumerate(story_infos, 1):
        write_md(f'edit-{i:02d}-{s["slug"]}.md', [
            ('title', s['title']),
            ('date', '2026-10-11'),
            ('category', s['meta']),
            ('image', s['image']),
            ('image_alt', s['alt']),
            ('excerpt', s['excerpt']),
            ('section', 'edit'),
        ], [])
    for n in note_infos:
        write_md(f'note-{n["slug"]}.md', [
            ('title', n['title']),
            ('date', '2026-10-11'),
            ('category', 'Style notes'),
            ('image', ''),
            ('image_alt', ''),
            ('excerpt', n['excerpt']),
            ('section', 'journal'),
        ], n['paras'])
    print(f'wrote {len(story_infos) + len(note_infos)} markdown files')

    # ---------- 5. template ----------
    def replace_div_inner(html, div_open, marker_open, marker_close, inner_indent, close_indent):
        """Replace the entire inner HTML of the first <div ...> matching div_open
        with a marker pair, preserving the div's own indentation."""
        start = html.find(div_open)
        assert start != -1, div_open
        # find matching </div> by depth counting
        pos = start + len(div_open)
        depth = 1
        tag_re = re.compile(r'</?div\b[^>]*>', re.I)
        for m in tag_re.finditer(html, pos):
            if m.group(0).startswith('</'):
                depth -= 1
            else:
                depth += 1
            if depth == 0:
                end = m.start()
                break
        else:
            raise AssertionError('unbalanced div for ' + div_open)
        inner = (f'\n{inner_indent}{marker_open}\n'
                 f'{inner_indent}{marker_close}\n{close_indent}')
        return html[:start + len(div_open)] + inner + html[end:]

    tpl = html
    # hero image -> file reference (only the hero img; story imgs are re-rendered)
    tpl = tpl.replace(
        f'src="data:image/{fmt};base64,{b64}"',
        f'src="/images/hero.{ext}"', 1)
    assert '/images/hero.' in tpl
    # story cards -> single section marker pair (allows the collection to grow)
    tpl = replace_div_inner(tpl, '<div class="stories">',
                            '<!--STORIES-->', '<!--/STORIES-->',
                            '        ', '      ')
    assert tpl.count('<!--STORIES-->') == 1
    # journal rows -> single section marker pair
    tpl = replace_div_inner(tpl, '<div class="article-list">',
                            '<!--JOURNAL-->', '<!--/JOURNAL-->',
                            '          ', '        ')
    assert tpl.count('<!--JOURNAL-->') == 1
    # no leftover data URIs (favicon data:, is fine)
    assert 'data:image' not in tpl, "leftover data URIs in template"
    # appended CSS for CMS-added story expandables (never renders for current content)
    extra_css = """
    /* CMS addition: expandable body for featured stories (renders only when a story has body text) */
    .story-more { margin-top: 12px; }
    .story-more summary { cursor: pointer; list-style: none; }
    .story-more summary::-webkit-details-marker { display: none; }
    .story-more summary::marker { display: none; }
    .story-more[open] .read-cue::after { content: "\\2212"; }
    .story-body { margin-top: 10px; }
    .story-body p { margin: 0 0 1em; }
"""
    tpl4 = tpl.replace('\n  </style>', '\n' + extra_css.strip('\n') + '\n  </style>', 1)
    assert extra_css.strip()[:20] in tpl4
    tdir = os.path.join(ROOT, 'templates')
    os.makedirs(tdir, exist_ok=True)
    open(os.path.join(tdir, 'base.html'), 'w', encoding='utf-8').write(tpl4)
    print('template written:', len(tpl4), 'chars')

if __name__ == '__main__':
    main()
