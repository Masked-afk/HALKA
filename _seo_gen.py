#!/usr/bin/env python3
"""SEO paketi: robots.txt + sitemap.xml + /eser/{id}/ OG stub'ları üretir.
Her push/deploy öncesi çalıştır: python _seo_gen.py"""
import json, os, re, urllib.request

BASE = 'https://halka-sosyal.com'
ROOT = os.path.dirname(os.path.abspath(__file__))
APP = open(os.path.join(ROOT, 'assets/js/app.js'), encoding='utf-8').read(2000)
SB_URL = re.search(r"SUPABASE_URL\s*=\s*'([^']+)'", APP).group(1)
SB_KEY = re.search(r"SUPABASE_KEY\s*=\s*'([^']+)'", APP).group(1)

def api(path):
    req = urllib.request.Request(f'{SB_URL}/rest/v1/{path}',
        headers={'apikey': SB_KEY, 'Authorization': f'Bearer {SB_KEY}'})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())

def esc(s):
    return (str(s or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            .replace('"', '&quot;').replace("'", '&#39;'))

posts = api('posts?select=id,title,kind,description,author_id,media_url,created_at&is_draft=eq.false&order=created_at.desc&limit=500')
profiles = {p['id']: p for p in api('profiles?select=id,username,display_name')}

os.makedirs(os.path.join(ROOT, 'eser'), exist_ok=True)
urls = [BASE + '/', BASE + '/#/dergi']
written = 0

for p in posts:
    title = p.get('title') or 'Başlıksız eser'
    kind = p.get('kind') or 'yazi'
    author = (profiles.get(p.get('author_id')) or {}).get('display_name') or 'Halka yazarı'
    desc = (p.get('description') or '').strip()[:155].replace('\n', ' ') or f'{author} tarafından HALKA\'da paylaşılan bir {kind} eseri.'
    img = p.get('media_url') if kind in ('drawing', 'photo', 'manga') else f'{BASE}/assets/icons/icon-512.png'
    path = f'eser/{p["id"]}'
    urls.append(f'{BASE}/{path}/')
    d = os.path.join(ROOT, 'eser', p['id'])
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, 'index.html'), 'w', encoding='utf-8').write(f'''<!DOCTYPE html>
<html lang="tr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(title)} — {esc(author)} · HALKA</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{BASE}/{path}/">
<meta property="og:type" content="article">
<meta property="og:site_name" content="HALKA">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:image" content="{esc(img)}">
<meta property="og:url" content="{BASE}/{path}/">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(desc)}">
<meta name="twitter:image" content="{esc(img)}">
<script type="application/ld+json">{{"@context":"https://schema.org","@type":"Article","headline":{json.dumps(title, ensure_ascii=False)},"author":{{"@type":"Person","name":{json.dumps(author, ensure_ascii=False)}}},"publisher":{{"@type":"Organization","name":"HALKA"}},"datePublished":"{p.get('created_at','')}","url":"{BASE}/{path}/"}}</script>
<script>location.replace('/#/read/{p["id"]}')</script>
</head><body>
<h1>{esc(title)}</h1><p>{esc(desc)}</p><p>Yazar: {esc(author)}</p>
<p><a href="/#/read/{p["id"]}">HALKA'da oku →</a></p>
</body></html>''')
    written += 1

open(os.path.join(ROOT, 'sitemap.xml'), 'w', encoding='utf-8').write(
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + ''.join(f'  <url><loc>{u}</loc></url>\n' for u in urls) + '</urlset>\n')

open(os.path.join(ROOT, 'robots.txt'), 'w', encoding='utf-8').write(
    f'User-agent: *\nAllow: /\n\nSitemap: {BASE}/sitemap.xml\n')

print(f'{written} eser stub + {len(urls)} sitemap URL uretildi')
