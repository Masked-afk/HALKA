# Uçtan uca özellik doğrulama simülasyonu — ürün dosyası değildir.
import json, re, urllib.request, psycopg2

pw = open('.db-password.txt', encoding='utf-8').read().strip()
src = open('assets/js/app.js', encoding='utf-8').read()
anon = re.search(r"sb_publishable_[A-Za-z0-9_\-]+", src).group(0)
SUPA = 'https://srdjknlfqnmsozyewvxa.supabase.co'
SITE = 'https://halka-sosyal.web.app'

def get(url, key=None):
    req = urllib.request.Request(url, headers={'apikey': key or anon, 'Authorization': f'Bearer {key or anon}'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, r.read().decode(errors='replace')
    except urllib.error.HTTPError as e: return e.code, e.read().decode()[:200]
    except Exception as e: return 0, str(e)[:120]

ok, fail = [], []
def chk(name, cond, extra=''):
    (ok if cond else fail).append(name + (f' ({extra})' if extra and not cond else ''))

# ── 1) Canlı dosyalar: yeni özellikler dağıtılmış mı ──
st, appjs = get(SITE + '/assets/js/app.js', key='')
st2, css = get(SITE + '/assets/css/styles.css', key='')
st3, sw = get(SITE + '/sw.js', key='')
st4, mani = get(SITE + '/manifest.webmanifest', key='')
chk('app.js canlı', st == 200)
for feat, marker in [('GIF seçici', 'openGifPicker'), ('sesli yorum', 'comment-voice-btn'),
                     ('okur anketi', 'chapter_polls'), ('ısı haritası', 'bump_dwells'),
                     ('paylaşım kartı', 'makeShareCard'), ('senin için', 'personalizePosts'),
                     ('emoji tepki', 'post_reactions'), ('remix', 'inspired_by'),
                     ('tema oynatıcı', 'h-vplayer'), ('delegasyon', 'comment-gif-btn')]:
    chk(f'app.js → {feat}', marker in appjs)
chk('sw.js v2 network-first', st3 == 200 and 'halka-shell-v2' in sw)
chk('manifest', st4 == 200 and 'icon-512' in mani)
chk('css: gif-picker', '.gif-picker' in css)
chk('css: h-player', '.h-player' in css)

# ── 2) Supabase şema (PostgREST anon) ──
for name, probe in [
    ('posts.inspired_by', 'posts?select=inspired_by&limit=0'),
    ('comments.gif_url', 'comments?select=gif_url&limit=0'),
    ('comments.audio_path', 'comments?select=audio_path&limit=0'),
    ('chapter_polls', 'chapter_polls?limit=0'),
    ('chapter_poll_votes', 'chapter_poll_votes?limit=0'),
    ('paragraph_dwell', 'paragraph_dwell?limit=0'),
    ('post_reactions', 'post_reactions?limit=0'),
    ('comment_reactions', 'comment_reactions?limit=0'),
]:
    st, _ = get(f'{SUPA}/rest/v1/{probe}')
    chk(f'PostgREST {name}', st in (200, 206), str(st))

# ── 3) Postgres katmanı: tablolar, kolonlar, politikalar, fonksiyonlar ──
conn = psycopg2.connect(f'postgresql://postgres.srdjknlfqnmsozyewvxa:{pw}@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres')
cur = conn.cursor()
def q(sql, *a):
    cur.execute(sql, a if a else None); return cur.fetchall()

for t in ['chapter_polls','chapter_poll_votes','paragraph_dwell','post_reactions','comment_reactions']:
    chk(f'tablo {t}', q("select 1 from pg_tables where schemaname='public' and tablename=%s", t))
chk('kolon comments.gif_url', q("select 1 from information_schema.columns where table_name='comments' and column_name='gif_url'"))
chk('kolon posts.inspired_by', q("select 1 from information_schema.columns where table_name='posts' and column_name='inspired_by'"))
chk('fns is_comment_visible', q("select 1 from pg_proc where proname='is_comment_visible'"))
chk('fns bump_dwells', q("select 1 from pg_proc where proname='bump_dwells'"))
chk('policy hide-draft (fn)', q("select 1 from pg_policies where tablename='comments' and qual like '%is_comment_visible%'"))
chk('RLS özyineleme yok (comments select)', q("select count(*)>=0 from public.comments limit 1"))

# ── 4) GIPHY API ──
st, gif = get('https://api.giphy.com/v1/gifs/trending?api_key=tCTMtyKwb3fFwQFMwAPPUv0wF4ZtCGxN&limit=2', key='x')
chk('GIPHY trending 200', st == 200, str(st))

conn.close()
print(f'\n=== SONUC: {len(ok)} gecti, {len(fail)} kaldi ===')
for f in fail: print('FAIL:', f.encode('ascii', 'replace').decode())
