#!/usr/bin/env node
/**
 * Glamora Girl — static site builder (zero dependencies, node built-ins only).
 *
 * Reads content/articles/*.md (YAML frontmatter + markdown body) and renders
 * them into templates/base.html, producing public/index.html.
 * Copies static/images -> public/images.
 *
 * Usage: node build.js   (run from the project root)
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CONTENT_DIR = path.join(ROOT, 'content', 'articles');
const TEMPLATE = path.join(ROOT, 'templates', 'base.html');
const PUBLIC = path.join(ROOT, 'public');

/* ---------------- tiny frontmatter parser ---------------- */
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) throw new Error('missing frontmatter');
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
      v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    fm[kv[1]] = v;
  }
  return { fm, body: m[2] };
}

/* ---------------- tiny markdown -> html ---------------- */
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function inlineMd(s) {
  let out = esc(s);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return out;
}
function mdToParagraphs(md) {
  return md.split(/\r?\n\s*\r?\n/).map(b => b.trim()).filter(Boolean);
}
function mdToHtml(md) {
  return mdToParagraphs(md).map(p => `              <p>${inlineMd(p.replace(/\r?\n/g, ' '))}</p>`).join('\n');
}

/* ---------------- article renderers (match original markup exactly) ---------------- */
function renderStory(a) {
  const img = a.image
    ? `\n          <div class="story-image"><img src="${esc(a.image)}" alt="${esc(a.image_alt || a.title)}" /></div>`
    : '';
  const more = a.bodyHtml
    ? `\n          <details class="story-more">\n            <summary><span class="read-cue">Read the story</span></summary>\n            <div class="story-body">\n${a.bodyHtml}\n            </div>\n          </details>`
    : '';
  return `<article class="story">${img}\n          <p class="story-meta">${esc(a.category)}</p>\n          <h3>${esc(a.title)}</h3>\n          <p>${esc(a.excerpt)}</p>${more}\n        </article>`;
}

function renderJournalRow(a, no) {
  const mins = Math.max(1, Math.round(a.wordCount / 200));
  return `<details class="article-row">\n            <summary>\n              <span class="article-no">${no}</span>\n              <div><h3>${esc(a.title)}</h3><p class="article-summary">${esc(a.excerpt)}</p></div>\n              <span class="read-time">${mins} min read <span class="read-cue">Read</span></span>\n            </summary>\n            <div class="article-body">\n${a.bodyHtml}\n            </div>\n          </details>`;
}

/* ---------------- main ---------------- */
function main() {
  const files = fs.readdirSync(CONTENT_DIR).filter(f => f.endsWith('.md')).sort();
  if (!files.length) throw new Error('no articles found in ' + CONTENT_DIR);

  const articles = files.map(f => {
    const raw = fs.readFileSync(path.join(CONTENT_DIR, f), 'utf8');
    const { fm, body } = parseFrontmatter(raw);
    for (const k of ['title', 'date', 'section']) {
      if (!fm[k]) throw new Error(`${f}: missing required frontmatter "${k}"`);
    }
    const paras = mdToParagraphs(body);
    return {
      file: f,
      title: fm.title,
      date: fm.date,
      category: fm.category || '',
      image: fm.image || '',
      image_alt: fm.image_alt || '',
      excerpt: fm.excerpt || '',
      section: fm.section,
      bodyHtml: mdToHtml(body),
      wordCount: paras.join(' ').split(/\s+/).filter(Boolean).length,
    };
  });

  const rank = s => (s === 'edit' ? 0 : 1);
  const byDateDesc = (x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : (x.file < y.file ? -1 : 1));
  const edits = articles.filter(a => rank(a.section) === 0).sort(byDateDesc);
  const notes = articles.filter(a => rank(a.section) !== 0).sort(byDateDesc);

  let tpl = fs.readFileSync(TEMPLATE, 'utf8');

  // Section markers: the template holds one marker pair per article section,
  // so the collections can grow via the CMS. Rendered cards reproduce the
  // original markup and indentation exactly.
  const storySlot = '<!--STORIES-->\n        <!--/STORIES-->';
  if (!tpl.includes(storySlot)) throw new Error('stories marker pair missing in template');
  tpl = tpl.replace(
    storySlot,
    '<!--STORIES-->\n' +
      edits.map(a => '        ' + renderStory(a)).join('\n') +
      '\n        <!--/STORIES-->'
  );

  const journalSlot = '<!--JOURNAL-->\n          <!--/JOURNAL-->';
  if (!tpl.includes(journalSlot)) throw new Error('journal marker pair missing in template');
  tpl = tpl.replace(
    journalSlot,
    '<!--JOURNAL-->\n' +
      notes.map((a, i) => '          ' + renderJournalRow(a, String(i + 1).padStart(2, '0'))).join('\n') +
      '\n          <!--/JOURNAL-->'
  );

  fs.mkdirSync(PUBLIC, { recursive: true });
  fs.writeFileSync(path.join(PUBLIC, 'index.html'), tpl, 'utf8');

  // copy images: static/images -> public/images
  const srcImg = path.join(ROOT, 'static', 'images');
  const dstImg = path.join(PUBLIC, 'images');
  fs.mkdirSync(dstImg, { recursive: true });
  let copied = 0;
  for (const f of fs.readdirSync(srcImg)) {
    fs.copyFileSync(path.join(srcImg, f), path.join(dstImg, f));
    copied++;
  }

  // copy admin panel: static/admin -> public/admin (Decap CMS + config)
  const srcAdmin = path.join(ROOT, 'static', 'admin');
  const dstAdmin = path.join(PUBLIC, 'admin');
  fs.mkdirSync(dstAdmin, { recursive: true });
  let adminCopied = 0;
  for (const f of fs.readdirSync(srcAdmin)) {
    fs.copyFileSync(path.join(srcAdmin, f), path.join(dstAdmin, f));
    adminCopied++;
  }

  console.log(`built public/index.html (${tpl.length} chars)`);
  console.log(`articles: ${edits.length} featured stories, ${notes.length} journal notes`);
  console.log(`images copied: ${copied}`);
  console.log(`admin files copied: ${adminCopied}`);

  // SEO: robots.txt + sitemap.xml
  fs.writeFileSync(
    path.join(PUBLIC, 'robots.txt'),
    'User-agent: *\nAllow: /\n\nSitemap: https://glamoragirl.online/sitemap.xml\n',
    'utf8'
  );
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: 'https://glamoragirl.online/', lastmod: today, changefreq: 'weekly', priority: '1.0' },
  ];
  const sitemap =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls
      .map(
        (u) =>
          `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
      )
      .join('\n') +
    '\n</urlset>\n';
  fs.writeFileSync(path.join(PUBLIC, 'sitemap.xml'), sitemap, 'utf8');
  console.log('robots.txt + sitemap.xml written');
}

main();
