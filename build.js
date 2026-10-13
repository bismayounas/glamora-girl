#!/usr/bin/env node
/**
 * Glamora Girl — static site builder (zero dependencies, node built-ins only).
 *
 * Reads content/articles/*.md (YAML frontmatter + markdown body) and renders:
 *   - templates/base.html    -> public/index.html (featured + latest grid + sidebar + edit strip)
 *   - templates/article.html -> public/articles/<slug>.html (one page per article)
 * Copies templates/style.css -> public/site.css, static/images -> public/images,
 * static/admin -> public/admin, static/*.html -> public/.
 *
 * Usage: node build.js   (run from the project root)
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CONTENT_DIR = path.join(ROOT, 'content', 'articles');
const TPL_DIR = path.join(ROOT, 'templates');
const PUBLIC = path.join(ROOT, 'public');
const SITE = 'https://glamoragirl.online';

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
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function inlineMd(s) {
  let out = esc(s);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*\w])\*([^\*\n]+)\*/g, '$1<em>$2</em>');
  return out;
}
function mdToParagraphs(md) {
  return md.split(/\r?\n\s*\r?\n/).map(b => b.trim()).filter(Boolean);
}
function mdToHtml(md) {
  return mdToParagraphs(md).map(p => `<p>${inlineMd(p.replace(/\r?\n/g, ' '))}</p>`).join('\n');
}
function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/* ---------------- renderers ---------------- */
function imgFor(a) {
  if (a.image) return a.image;
  if (fs.existsSync(path.join(ROOT, 'static', 'images', `${a.slug}.jpg`))) return `/images/${a.slug}.jpg`;
  return '/images/hero.jpg';
}
function renderFeatured(a) {
  return `<div class="featured-card">
          <div class="featured-media"><img src="${esc(imgFor(a))}" alt="${esc(a.image_alt || a.title)}" /></div>
          <div class="featured-copy">
            <p class="kicker">Featured · ${esc(a.category || 'Style notes')}</p>
            <h1><a href="${a.url}">${esc(a.title)}</a></h1>
            <p class="dateline">${esc(fmtDate(a.date))}</p>
            <p class="excerpt">${esc(a.excerpt)}</p>
            <a class="btn" href="${a.url}">Read More</a>
          </div>
        </div>`;
}
function renderCard(a) {
  return `<article class="card">
            <div class="card-media"><a href="${a.url}" aria-label="${esc(a.title)}"><img src="${esc(imgFor(a))}" alt="${esc(a.image_alt || a.title)}" loading="lazy" /></a></div>
            <div class="card-body">
              <p class="kicker">${esc(a.category || 'Style notes')}</p>
              <h3 class="card-title"><a href="${a.url}">${esc(a.title)}</a></h3>
              <p class="dateline">${esc(fmtDate(a.date))}</p>
              <p class="excerpt">${esc(a.excerpt)}</p>
            </div>
          </article>`;
}
function renderEditCard(a) {
  return `<article class="edit-card">
            <a href="${a.url}" aria-label="${esc(a.title)}"><img src="${esc(imgFor(a))}" alt="${esc(a.image_alt || a.title)}" loading="lazy" /></a>
            <div class="card-body">
              <p class="kicker">${esc(a.category || 'The Edit')}</p>
              <h3 class="card-title"><a href="${a.url}">${esc(a.title)}</a></h3>
              <p class="excerpt">${esc(a.excerpt)}</p>
            </div>
          </article>`;
}
function renderRecent(a) {
  return `<li><a href="${a.url}">${esc(a.title)}<time>${esc(fmtDate(a.date))}</time></a></li>`;
}
function renderArticleBody(a) {
  return `<div class="article-hero">
          <div class="wrap">
            <p class="kicker">${esc(a.category || 'Style notes')}</p>
            <h1>${esc(a.title)}</h1>
            <p class="dateline">${esc(fmtDate(a.date))} · Glamora Girl</p>
          </div>
        </div>
        <div class="article-media"><img src="${esc(imgFor(a))}" alt="${esc(a.image_alt || a.title)}" /></div>
        <div class="article-body">
${a.bodyHtml}
        </div>`;
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
    const slug = f.replace(/\.md$/, '');
    return {
      file: f, slug,
      url: `/articles/${slug}.html`,
      title: fm.title, date: fm.date,
      category: fm.category || '',
      image: fm.image || '', image_alt: fm.image_alt || '',
      excerpt: fm.excerpt || '', section: fm.section,
      bodyHtml: mdToHtml(body),
    };
  });

  const byDateDesc = (x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : (x.file < y.file ? -1 : 1));
  const all = [...articles].sort(byDateDesc);
  const edits = articles.filter(a => a.section === 'edit').sort(byDateDesc);
  const notes = articles.filter(a => a.section !== 'edit').sort(byDateDesc);

  const fill = (tpl, marker, html) => {
    const re = new RegExp(`<!--${marker}-->[\\s\\S]*?<!--\\/${marker}-->`);
    if (!re.test(tpl)) throw new Error(`${marker} marker pair missing in template`);
    return tpl.replace(re, `<!--${marker}-->\n${html}\n<!--/${marker}-->`);
  };

  /* ---- homepage ---- */
  let home = fs.readFileSync(path.join(TPL_DIR, 'base.html'), 'utf8');
  const featured = all[0];
  const latest = notes.slice(0, 6);
  home = fill(home, 'FEATURED', '        ' + renderFeatured(featured));
  home = fill(home, 'LATEST', latest.map(a => '            ' + renderCard(a)).join('\n'));
  home = fill(home, 'EDIT', edits.slice(0, 3).map(a => '          ' + renderEditCard(a)).join('\n'));
  home = fill(home, 'RECENT', all.slice(0, 5).map(a => '              ' + renderRecent(a)).join('\n'));

  fs.mkdirSync(PUBLIC, { recursive: true });
  fs.writeFileSync(path.join(PUBLIC, 'index.html'), home, 'utf8');

  /* ---- article pages ---- */
  const artTpl = fs.readFileSync(path.join(TPL_DIR, 'article.html'), 'utf8');
  const artDir = path.join(PUBLIC, 'articles');
  fs.mkdirSync(artDir, { recursive: true });
  for (const a of articles) {
    let page = artTpl;
    const titleTag = `  <title>${esc(a.title)} — Glamora Girl</title>`;
    const meta = [
      `  <meta name="description" content="${esc(a.excerpt)}" />`,
      `  <link rel="canonical" href="${SITE}${a.url}" />`,
      `  <meta name="robots" content="index, follow" />`,
      `  <meta property="og:type" content="article" />`,
      `  <meta property="og:site_name" content="Glamora Girl" />`,
      `  <meta property="og:title" content="${esc(a.title)} — Glamora Girl" />`,
      `  <meta property="og:description" content="${esc(a.excerpt)}" />`,
      `  <meta property="og:url" content="${SITE}${a.url}" />`,
      `  <meta property="og:image" content="${SITE}${esc(imgFor(a))}" />`,
      `  <meta name="twitter:card" content="summary_large_image" />`,
      `  <meta name="twitter:title" content="${esc(a.title)} — Glamora Girl" />`,
      `  <meta name="twitter:description" content="${esc(a.excerpt)}" />`,
      `  <meta name="twitter:image" content="${SITE}${esc(imgFor(a))}" />`,
    ].join('\n');
    page = page.replace('<!--TITLE-->', titleTag).replace('<!--META-->', meta);
    const more = all.filter(x => x.slug !== a.slug).slice(0, 3);
    page = fill(page, 'ARTICLE', '    ' + renderArticleBody(a));
    page = fill(page, 'MORE', more.map(x => '          ' + renderCard(x)).join('\n'));
    fs.writeFileSync(path.join(artDir, `${a.slug}.html`), page, 'utf8');
  }

  /* ---- static assets ---- */
  fs.copyFileSync(path.join(TPL_DIR, 'style.css'), path.join(PUBLIC, 'site.css'));
  const copyTree = (src, dst) => {
    let n = 0;
    for (const f of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, f.name), d = path.join(dst, f.name);
      if (f.isDirectory()) { fs.mkdirSync(d, { recursive: true }); n += copyTree(s, d); }
      else { fs.copyFileSync(s, d); n++; }
    }
    return n;
  };
  const dstImg = path.join(PUBLIC, 'images');
  fs.mkdirSync(dstImg, { recursive: true });
  const copied = copyTree(path.join(ROOT, 'static', 'images'), dstImg);
  const dstAdmin = path.join(PUBLIC, 'admin');
  fs.mkdirSync(dstAdmin, { recursive: true });
  copyTree(path.join(ROOT, 'static', 'admin'), dstAdmin);
  let pagesCopied = 0;
  for (const f of fs.readdirSync(path.join(ROOT, 'static'))) {
    if (f.endsWith('.html')) { fs.copyFileSync(path.join(ROOT, 'static', f), path.join(PUBLIC, f)); pagesCopied++; }
  }

  /* ---- SEO: robots.txt + sitemap.xml ---- */
  fs.writeFileSync(path.join(PUBLIC, 'robots.txt'),
    'User-agent: *\nAllow: /\n\nSitemap: https://glamoragirl.online/sitemap.xml\n', 'utf8');
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${SITE}/`, changefreq: 'weekly', priority: '1.0' },
    { loc: `${SITE}/privacy.html`, changefreq: 'yearly', priority: '0.3' },
    ...articles.map(a => ({ loc: `${SITE}${a.url}`, changefreq: 'monthly', priority: '0.8' })),
  ];
  const sitemap =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`).join('\n') +
    '\n</urlset>\n';
  fs.writeFileSync(path.join(PUBLIC, 'sitemap.xml'), sitemap, 'utf8');

  console.log(`built public/index.html + ${articles.length} article pages`);
  console.log(`images copied: ${copied}, static pages: ${pagesCopied}`);
  console.log('robots.txt + sitemap.xml written');
}

main();
