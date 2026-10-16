/* HALKA SUPABASE AYARLARI */
const SUPABASE_URL = 'https://srdjknlfqnmsozyewvxa.supabase.co';
const SUPABASE_KEY = 'sb_publishable_2be-TiF4ZoZg_HNmA8dW1g_1UzYtfCr';

const app = document.getElementById('app');
const nav = document.getElementById('nav');

const HALKA_LOADER = `<svg class="halka-loader" viewBox="266 62 148 146" aria-hidden="true">
<g class="lr lr1"><use href="#hkcT" stroke="#A89F88" stroke-width="12.4"/><use href="#hkcT" stroke="url(#hkpTL)" stroke-width="10.4"/></g>
<g class="lr lr2"><use href="#hkcUR" stroke="#C7C5BC" stroke-width="12.4"/><use href="#hkcUR" stroke="url(#hkpTR)" stroke-width="10.4"/></g>
<g class="lr lr3"><use href="#hkcLR" stroke="#EFE4CC" stroke-width="12.6"/><use href="#hkcLR" stroke="url(#hkpBR)" stroke-width="8.6"/></g>
<g class="lr lr4"><use href="#hkcB" stroke="#8C8C96" stroke-width="12.4"/><use href="#hkcB" stroke="url(#hkpVD)" stroke-width="10.4"/></g>
<g class="lr lr5"><use href="#hkcLL" stroke="#9DB7D4" stroke-width="12.4"/><use href="#hkcLL" stroke="url(#hkpMU)" stroke-width="10.4"/></g>
<g class="lr lr6"><use href="#hkcUL" stroke="#C79AAE" stroke-width="12.4"/><use href="#hkcUL" stroke="url(#hkpCO)" stroke-width="10.4"/></g>
</svg>`;

function fillLoaders() {
  document.querySelectorAll('.spinner-rings').forEach(el => {
    if (!el.querySelector('.halka-loader')) el.innerHTML = HALKA_LOADER;
  });
}
fillLoaders();
new MutationObserver(fillLoaders).observe(app, { childList: true, subtree: true });
const HALKA_LOGO = HALKA_LOADER.replace('class="halka-loader"', 'class="halka-logo"');
document.getElementById('brandLogo').innerHTML = HALKA_LOGO;

let sb = null;
let currentUser = null;
let isCurrentUserAdmin = false;
let draftKind = null;
let draftDirty = false;
let lastAccessToken = null;
let chatChannel = null;
let typingHideTimer = null;
let communityPollTimer = null;
let communityRealtime = null;
let readScrollHandler = null;
let badgeStatsCache = null;

function markDraftDirty(kind) { draftKind = kind; draftDirty = true; }
function clearDraft() { draftKind = null; draftDirty = false; }
function flushDraftAbandon() {
  if (!draftDirty || !draftKind || !currentUser || !sb) { clearDraft(); return; }
  const kind = draftKind;
  clearDraft();
  sb.rpc('record_draft_abandon', { p_kind: kind }).then(({ data }) => {
    const awarded = data?.awarded || [];
    if (!awarded.length) return;
    const names = awarded.map(k => BADGE_DEFS.find(b => b.key === k)?.name || k);
    const toast = document.createElement('div');
    toast.className = 'badge-toast';
    toast.innerHTML = `<strong>Yeni rozet kazandın!</strong><br>${esc(names.join(' · '))}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 50);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 4200);
    cemberCelebrate(`Tebrikler! ${names.join(', ')} rozetini kazandın. Yine de yarım bırakmadan bir eser bitirmeni tercih ederim.`);
  }).catch(() => {});
}
function flushDraftAbandonOnLeave() {
  if (!draftDirty || !draftKind || !lastAccessToken) return;
  const kind = draftKind;
  clearDraft();
  try {
    fetch(`${SUPABASE_URL}/rest/v1/rpc/record_draft_abandon`, {
      method: 'POST', keepalive: true,
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${lastAccessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_kind: kind })
    });
  } catch {}
}
let currentProfile = null;
let cachedPosts = [];
let currentAuthMode = 'signup';
let feedSort = 'new';
let feedSearch = '';
let feedCritique = false;
let chatRefreshTimer = null;

// Supabase'te kurulumu tamamlanan sağlayıcıları buraya ekle: 'google','github','facebook','twitter','apple','discord'
const ENABLED_OAUTH_PROVIDERS = ['google', 'github'];
const OAUTH_PROVIDER_NAMES = { google: 'Google', github: 'GitHub', facebook: 'Facebook', twitter: 'X', apple: 'Apple', discord: 'Discord' };
// Twilio/SMS sağlayıcısı kurulduğunda true yap
const PHONE_AUTH_ENABLED = false;
const LEGAL_VERSIONS = { terms: '2026-10-11-v1', privacy: '2026-10-11-v1', community: '2026-10-11-v1' };
const LEGAL_LABELS = { terms: 'Kullanıcı Sözleşmesi', privacy: 'Gizlilik ve KVKK Aydınlatma Metni', community: 'Topluluk Kuralları' };
function legalCheckboxes(prefix = 'legal') {
  const statements = {
    terms: '’ni okudum ve kabul ediyorum.',
    privacy: '’ni okudum.',
    community: '’nı okudum ve kabul ediyorum.'
  };
  return Object.entries(LEGAL_LABELS).map(([key, label]) => `<label class="legal-check"><input type="checkbox" name="${prefix}_${key}" required><span><a href="#/legal/${key}" target="_blank" rel="noopener">${label}</a>${statements[key]}</span></label>`).join('');
}
function hasLegalConsent(form, prefix = 'legal') {
  return Boolean(form) && Object.keys(LEGAL_LABELS).every(key => form.querySelector(`[name="${prefix}_${key}"]`)?.checked);
}
function currentLegalMetadata() {
  return { terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy, community_rules_version: LEGAL_VERSIONS.community };
}

const categories = ['Fantastik','Bilim Kurgu','Romantik','Gizem','Korku','Macera','Dram','Deneme','Günlük','Yaşam','Diğer'];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;',
    '"':'&quot;', "'":'&#39;'
  })[ch]);
}
function initials(name) {
  const s = String(name || 'H').trim();
  return esc(s ? s[0].toLocaleUpperCase('tr-TR') : 'H');
}
function showMessage(text, error = false) {
  const el = document.getElementById('message');
  if (!el) return;
  el.textContent = text;
  el.className = error ? 'message error' : 'message';
}
function displayName(profile, fallback = 'Halka yazarı') {
  return profile?.display_name?.trim() || profile?.username || fallback;
}
function safeHex(value, fallback = '#d9b978') {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
}
function profileAccent(profile) {
  return safeHex(profile?.profile_accent);
}

// ---- Seviye & rozet sistemi ----
const LEVEL_STEPS = [0, 20, 50, 100, 160, 240, 340, 460, 600, 760, 940, 1140, 1360, 1600, 1860, 2140, 2440, 2760, 3100, 3600];
const LEVEL_NAMES = ['Tohum','Tohum','Tohum','Tohum','Filiz','Filiz','Filiz','Filiz','Dal','Dal','Dal','Dal','Ağaç','Ağaç','Ağaç','Ağaç','Orman','Orman','Orman','Halka Ustası'];
function levelInfo(score) {
  let lvl = 0;
  while (lvl + 1 < LEVEL_STEPS.length && score >= LEVEL_STEPS[lvl + 1]) lvl++;
  const floor = LEVEL_STEPS[lvl];
  const ceil = lvl + 1 < LEVEL_STEPS.length ? LEVEL_STEPS[lvl + 1] : null;
  return { num: lvl + 1, name: LEVEL_NAMES[lvl], floor, ceil,
    pct: ceil ? Math.min(100, Math.round((score - floor) / (ceil - floor) * 100)) : 100 };
}

const TRACK_DEFS = [
  { key: 'writing', name: 'Yazı', icon: '🖋️', stages: ['İmza', 'Kalem', 'Muharrir', 'Edebiyatçı'], need: [1, 10, 30, 100] },
  { key: 'drawing', name: 'Çizim', icon: '🎨', stages: ['Eskiz', 'Fırça', 'Ressam', 'Galeri'], need: [1, 10, 30, 100] },
  { key: 'photo', name: 'Fotoğraf', icon: '📷', stages: ['Kadraj', 'Vizör', 'Fotoğrafçı', 'Sergi'], need: [1, 10, 30, 100] },
  { key: 'video', name: 'Video', icon: '🎬', stages: ['Perde', 'Yönetmen', 'Stüdyo', 'Sinemacı'], need: [1, 10, 30, 100] },
  { key: 'music', name: 'Müzik', icon: '🎵', stages: ['Nota', 'Melodi', 'Besteci', 'Maestro'], need: [1, 10, 30, 100] },
  { key: 'likes', name: 'Beğeni', icon: '❤️', stages: ['Kıvılcım', 'Sevilen', 'Gözde', 'İkon'], need: [10, 100, 500, 2000] },
  { key: 'followers', name: 'Takipçi', icon: '👥', stages: ['İlk Halka', 'Cemiyet', 'Merkez', 'Yıldız'], need: [1, 10, 50, 200] },
  { key: 'bugs', name: 'Katkı', icon: '🔧', stages: ['Dikkatli', 'Kusur Avcısı', 'Bakım Teknisyeni'], need: [1, 5, 15], secret: true }
];

const BADGE_DEFS = [
  { key: 'ilk_eser', name: 'İlk Eser', desc: 'İlk eserini paylaştın', icon: '✦', prog: 'posts', total: 1 },
  { key: 'ilk_kitap', name: 'İlk Kitap', desc: 'Bölümlü bir eser yayımladın', icon: '📖' },
  { key: 'cok_yonlu', name: 'Çok Yönlü', desc: '4 farklı türde eser', icon: '🎭' },
  { key: 'tam_halka', name: 'Tam Halka', desc: '5 türün hepsinde eser', icon: '⭕' },
  { key: 'konusulan', name: 'Konuşulan', desc: 'Bir eserin 10+ yorum aldı', icon: '💬' },
  { key: 'hit', name: 'Hit', desc: 'Bir eserin 50+ beğeni aldı', icon: '🔥' },
  { key: 'fenomen', name: 'Fenomen', desc: 'Bir eserin 200+ görüntülendi', icon: '👁️' },
  { key: 'koleksiyon_ruhu', name: 'Koleksiyon Ruhu', desc: '50 eser kaydettin', icon: '◆' },
  { key: 'ilk_yorumun', name: 'İlk Yorumun', desc: 'İlk yorumunu yazdın', icon: '💭', prog: 'comments', total: 1 },
  { key: 'sohbetci', name: 'Sohbetçi', desc: '25 yorum', icon: '💬', prog: 'comments', total: 25 },
  { key: 'tartismaci', name: 'Tartışmacı', desc: '200 yorum', icon: '🗯️', prog: 'comments', total: 200 },
  { key: 'mektup', name: 'Mektup', desc: '100 sohbet mesajı', icon: '✉️', prog: 'messages', total: 100 },
  { key: 'geveze', name: 'Geveze', desc: '1000 sohbet mesajı', icon: '📨', prog: 'messages', total: 1000 },
  { key: 'tanis', name: 'Tanış', desc: 'İlk arkadaşın', icon: '🤝' },
  { key: 'ag', name: 'Ağ', desc: '20 arkadaş', icon: '🕸️' },
  { key: 'katilimci', name: 'Katılımcı', desc: 'Bir topluluğa üyesin', icon: '🏠' },
  { key: 'kurucu', name: 'Kurucu', desc: 'Bir topluluk kurdun', icon: '🏗️' },
  { key: 'buyukelci', name: 'Büyükelçi', desc: '50+ üyeli topluluk', icon: '🏛️' },
  { key: 'zincir', name: 'Zincir', desc: '7 gün üst üste paylaşım', icon: '🔗' },
  { key: 'demir_irade', name: 'Demir İrade', desc: '30 gün streak', icon: '⚓' },
  { key: 'kidemli', name: 'Kıdemli', desc: '30 gündür Halka’dasın', icon: '🌱' },
  { key: 'yerlesik', name: 'Yerleşik', desc: '180 gündür Halka’dasın', icon: '🌿' },
  { key: 'veteran', name: 'Veteran', desc: '1 yıldır Halka’dasın', icon: '🌳' },
  { key: 'geri_donus', name: 'Geri Dönüş', desc: '30+ gün aradan sonra tekrar paylaştın', icon: '↩️', secret: true },
  { key: 'gece_kusu', name: 'Gece Kuşu', desc: 'Gece yarısı ile sabah 5 arasında eser paylaştın', icon: '🦉', secret: true },
  { key: 'safak', name: 'Şafak', desc: 'Şafak vaktinde (05.00–07.00) eser paylaştın', icon: '🌅', secret: true },
  { key: 'gece_yazari', name: 'Gece Yazarı', desc: 'Gece saatlerinde 10 eser paylaştın', icon: '🌙', secret: true },
  { key: 'sansli_gun', name: 'Şanslı Gün', desc: 'Ayın 13’ünde saat 13’te paylaştın', icon: '🍀', secret: true },
  { key: 'erken_kus', name: 'Halkanın İlk Zincirlerinden', desc: 'İlk 100 üyeden birisin', icon: '🐣', secret: true },
  { key: 'sessiz_dev', name: 'Sessiz Dev', desc: 'Hiç yorum yapmadan 20 eser paylaştın', icon: '🗿', secret: true },
  { key: 'ilk_yorumcu', name: 'İlk Yorumcu', desc: '10 esere ilk yorumu sen yazdın', icon: '⚡', secret: true },
  { key: 'hafta_sonu', name: 'Hafta Sonu Savaşçısı', desc: '4 hafta üst üste hafta sonu paylaştın', icon: '🎪', secret: true },
  { key: 'kopru', name: 'Köprü', desc: '10 eserini sohbette paylaştın', icon: '🌉', secret: true },
  { key: 'merakli', name: 'Meraklı', desc: '4 farklı türde esere yorum yazdın', icon: '🔍', secret: true },
  { key: 'sirdas', name: 'Sırdaş', desc: 'Tek bir sohbette 500+ mesaj yazdın', icon: '🤫', secret: true },
  { key: 'bakim_gizlisi', name: 'Bakım Gizlisi', desc: '3 hata bildirimin çözüldü', icon: '🩹', secret: true },
  { key: 'senmi', name: 'Senmi?', desc: '"Benmi?" yazdın', icon: '🫵', secret: true },
  { key: 'medeni', name: 'Medeni', desc: '3+ topluluğa üyesin ve sicilin temiz', icon: '🕊️', secret: true },
  { key: 'abandon_drawing', name: 'Kalemi Kağıda Gitmeyen', desc: '5 çizimi yarıda bıraktın', icon: '🖊️', secret: true },
  { key: 'abandon_writing', name: 'Kelimesi Kursağında Kalan', desc: '5 yazıyı yarıda bıraktın', icon: '✍️', secret: true },
  { key: 'abandon_photo', name: 'Pozu Kaçıran', desc: '5 fotoğrafı yarıda bıraktın', icon: '📸', secret: true },
  { key: 'abandon_video', name: 'Kestik!', desc: '5 videoyu yarıda bıraktın', icon: '🎬', secret: true },
  { key: 'abandon_music', name: 'Bestesi Yarım', desc: '5 parçayı yarıda bıraktın', icon: '🎼', secret: true },
  { key: 'ilham_eksikligi', name: 'İlham Eksikliği', desc: 'Beş türün hepsinde yarıda bırakma rozetin var', icon: '🥀', secret: true },
  { key: 'cicek_acan', name: 'Hezarfen', desc: 'Beş üretim izinin hepsinde eserin var', icon: '🧭', meta: true },
  { key: 'bahcivan', name: 'Doruk', desc: 'Bir üretim izinde son aşamaya ulaştın', icon: '⛰️', meta: true },
  { key: 'uc_usta', name: 'Üç Doruk', desc: 'Üç üretim izinde III+ aşama', icon: '🏆', meta: true },
  { key: 'halka_efsanesi', name: 'Halka Efsanesi', desc: 'Tüm izlerde II+ aşama ve 10+ başarım', icon: '👑', meta: true }
];

function badgeShelfHTML(engagement, specialBadges = []) {
  const earned = new Set(engagement.earned_keys || []);
  const c = engagement.counts || {};
  const typeCounts = c.type_counts || {};
  const trackTypes = ['writing', 'drawing', 'photo', 'video', 'music'];
  if (trackTypes.every(t => (typeCounts[t] || 0) >= 10) && earned.size >= 10) earned.add('halka_efsanesi');

  const trackHtml = TRACK_DEFS.map(t => {
    const val = t.key === 'likes' ? (c.likes || 0) : t.key === 'followers' ? (c.followers || 0) : t.key === 'bugs' ? (c.bugs || 0) : (typeCounts[t.key] || 0);
    let stage = 0;
    while (stage < t.need.length && val >= t.need[stage]) stage++;
    const next = stage < t.need.length ? t.need[stage] : null;
    const prev = stage > 0 ? t.need[stage - 1] : 0;
    const pct = next ? Math.min(100, Math.round((val - prev) / (next - prev) * 100)) : 100;
    if (t.secret && stage === 0) {
      return `<div class="track-slot" title="Gizli iz — nasıl açıldığını keşfet"><div class="track-icon">🔒</div><div class="track-name">???</div><div class="track-stage">—</div><div class="track-bar"><div class="track-fill" style="width:0%"></div></div><div class="track-need">—</div></div>`;
    }
    return `<div class="track-slot ${stage ? 'active' : ''}" data-track="${t.key}" title="${esc(t.name)} — ${stage ? t.stages[stage - 1] + ' aşaması' : 'henüz yok'}${next ? ' · sonraki: ' + t.stages[stage] + ' (' + val + '/' + next + ')' : ' · tamamlandı'}">
      <div class="track-icon">${t.icon}</div>
      <div class="track-name">${esc(t.name)}</div>
      <div class="track-stage">${stage ? esc(t.stages[stage - 1]) : '—'}</div>
      <div class="track-bar"><div class="track-fill" style="width:${pct}%"></div></div>
      ${next ? `<div class="track-need">${val}/${next}</div>` : '<div class="track-need">MAX</div>'}
    </div>`;
  }).join('');

  const specialHtml = (specialBadges || []).map(b => `<div class="badge-slot earned special" data-badge="${esc(b.key)}" title="${esc(b.name)} — ${esc(b.desc || 'Özel rozet')}"><div class="badge-icon">${esc(b.icon || '✦')}</div><div class="badge-name">${esc(b.name)}</div></div>`).join('');

  const badgeHtml = BADGE_DEFS.map(b => {
    const has = earned.has(b.key);
    const prog = b.prog ? Math.min(c[b.prog] || 0, b.total || 1) : null;
    if (!has && b.secret) {
      return `<div class="badge-slot locked secret" data-badge="${b.key}" title="Gizli rozet"><div class="badge-icon">🔒</div><div class="badge-name">???</div></div>`;
    }
    return `<div class="badge-slot ${has ? 'earned' : 'locked'}" data-badge="${b.key}" title="${esc(b.name)} — ${esc(b.desc || '')}${!has && prog !== null ? ` (${prog}/${b.total})` : ''}">
      <div class="badge-icon">${has ? b.icon : '○'}</div>
      <div class="badge-name">${esc(has ? b.name : b.secret ? '???' : b.name)}</div>
      ${!has && prog !== null && prog > 0 ? `<div class="badge-prog">${prog}/${b.total}</div>` : ''}
    </div>`;
  }).join('');

  const earnedCount = BADGE_DEFS.filter(b => earned.has(b.key)).length + (specialBadges || []).length;
  const secretLeft = BADGE_DEFS.filter(b => b.secret && !earned.has(b.key)).length;

  return `<section class="card badge-shelf">
    <div class="section-head" style="margin-bottom:4px"><h2>Üretim yolu</h2><span class="small">${earnedCount} rozet${secretLeft ? ` · ${secretLeft} gizli kaldı` : ''}</span></div>
    <div class="track-grid">${trackHtml}</div>
    <div class="badge-grid">${specialHtml}${badgeHtml}</div>
  </section>`;
}
function resolveBadge(key, specialBadges = []) {
  const b = BADGE_DEFS.find(x => x.key === key);
  if (b) return b;
  const s = (specialBadges || []).find(x => x.key === key);
  if (s) return { key: s.key, name: s.name, desc: s.desc, icon: s.icon, special: true };
  const trackKeyMap = { yazi: 'writing', cizim: 'drawing', foto: 'photo', video: 'video', muzik: 'music', begeni: 'likes', takip: 'followers', katki: 'bugs' };
  const m = String(key).match(/^trk_([a-z]+)_(\d)$/);
  if (m) {
    const t = TRACK_DEFS.find(x => x.key === trackKeyMap[m[1]]);
    if (t) return { key, name: `${t.name} · ${t.stages[Number(m[2]) - 1]}`, desc: `${t.name} izinde ${m[2]}. aşama`, icon: t.icon, track: true };
  }
  return { key, name: key, desc: '', icon: '✦' };
}

function badgeRarityText(key, stats) {
  const n = stats?.counts?.[key] ?? 0;
  const users = stats?.users ?? 0;
  if (!n) return 'Bu rozeti henüz kimse kazanmadı.';
  return users ? `Bu rozeti ${n} kişi kazandı — kullanıcıların %${(n / users * 100).toFixed(1)}'i.` : `Bu rozeti ${n} kişi kazandı.`;
}

function openBadgeModal(info) {
  const overlay = document.createElement('div');
  overlay.className = 'badge-modal-backdrop';
  overlay.innerHTML = `<div class="badge-modal card">
    <button class="badge-modal-close" type="button" aria-label="Kapat">✕</button>
    <div class="badge-modal-icon">${info.icon}</div>
    <h3>${esc(info.name)}</h3>
    ${info.desc ? `<p class="subtitle">${esc(info.desc)}</p>` : ''}
    ${info.earnedAt ? `<p class="small">Kazanıldı: ${esc(formatDate(info.earnedAt))}</p>` : ''}
    ${info.rarity ? `<p class="small">${esc(info.rarity)}</p>` : ''}
    ${info.progText ? `<div class="level-bar" style="margin:8px 0"><div class="level-fill" style="width:${info.pct}%"></div></div><p class="small">${esc(info.progText)}</p>` : ''}
    ${info.canFeature ? `<button class="btn primary" id="badgeFeatureBtn" type="button">${info.isFeatured ? 'Öne çıkarmayı kaldır' : 'Profilde öne çıkar'}</button>` : ''}
  </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay || e.target.closest('.badge-modal-close')) close(); });
  if (info.canFeature) {
    overlay.querySelector('#badgeFeatureBtn').addEventListener('click', async () => {
      const next = info.isFeatured ? null : info.badgeKey;
      const { error } = await sb.from('profiles').update({ featured_badge: next }).eq('id', currentUser.id);
      if (error) { alert(error.message); return; }
      close();
      renderProfile('me');
    });
  }
}

function writingKindLabel(kind) {
  return ({ blog: 'Blog', short: 'Kısa Yazı', book: 'Kitap', story: 'Kitap', poem: 'Şiir', manga: 'Manga', light_novel: 'Light Novel' })[kind] || 'Yazı';
}
const CHAPTERED_KINDS = new Set(['book', 'story', 'manga', 'light_novel']);
function isChapteredKind(kind) { return CHAPTERED_KINDS.has(kind); }
function tagSlug(value) {
  return String(value || '').trim().replace(/^#+/, '').toLocaleLowerCase('tr-TR').replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 24);
}
function parseHashtags(value) {
  return [...new Set(String(value || '').split(/[\s,]+/).map(tagSlug).filter(Boolean))].slice(0, 5);
}
function postHashtags(post) {
  const tags = Array.isArray(post?.tags) ? post.tags : [];
  if (tags.length) return tags.map(tagSlug).filter(Boolean);
  return post?.category && post.category !== 'Diğer' ? [tagSlug(post.category)] : [];
}
function hashtagHTML(post) {
  const section = post?.type === 'drawing' ? 'cizimler' : post?.type === 'photo' ? 'fotograflar' : post?.type === 'video' ? 'videolar' : post?.type === 'music' ? 'muzikler' : 'yazilar';
  return postHashtags(post).map(tag => `<a class="hashtag" href="#/section/${section}?cat=${encodeURIComponent(tag)}">#${esc(tag)}</a>`).join('');
}
async function signedProfileImage(path) {
  if (!path) return '';
  const { data, error } = await sb.storage.from('profile-images').createSignedUrl(path, 3600);
  return error ? '' : (data?.signedUrl || '');
}
function profileAvatar(profile, name, imageUrl = '') {
  return `<div class="avatar">${imageUrl ? `<img src="${esc(imageUrl)}" alt="${esc(name)} profil fotoğrafı">` : initials(name)}</div>`;
}
function presenceHTML(lastActive) {
  if (!lastActive) return '';
  const diff = Date.now() - new Date(lastActive).getTime();
  if (diff < 5 * 60 * 1000) return '<div class="meta presence"><span class="presence-dot on"></span>Çevrimiçi</div>';
  return `<div class="meta presence"><span class="presence-dot"></span>Son görülme: ${esc(formatDate(lastActive))}</div>`;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('tr-TR', { day:'numeric', month:'long', year:'numeric' });
}
function categoryOptions(selected = 'Fantastik') {
  return categories.map(c => `<option value="${esc(c)}" ${c === selected ? 'selected' : ''}>${esc(c)}</option>`).join('');
}

function setNav() {
  nav.innerHTML = `
    <form class="nav-search" id="navSearchForm" role="search">
      <input id="navSearchInput" type="search" maxlength="80" placeholder="Ara…" aria-label="Halka'da ara" autocomplete="off">
      <button class="nav-search-btn" type="submit" aria-label="Ara">🔍</button>
    </form>
    ${currentUser ? `
      <a class="btn ghost" href="#/profile">Profilim</a>
      <a class="btn ghost" href="#/notifications" style="position:relative">Bildirimler<span id="navNotifBadge" class="notif-badge" hidden></span></a>
      <a class="btn ghost" href="#/chat">Sohbet</a>
      <a class="btn ghost" href="#/settings">Ayarlar</a>
      ${isCurrentUserAdmin ? '<a class="btn ghost" href="#/admin">Yönetim</a>' : ''}
      <button class="btn" id="logoutBtn">Çıkış</button>
    ` : `
      <a class="btn ghost" href="#/auth">Giriş</a>
      <a class="btn primary" href="#/auth?signup">Hesap oluştur</a>
    `}
    ${plusMenuHTML()}
  `;
  const navSearchForm = document.getElementById('navSearchForm');
  navSearchForm?.addEventListener('submit', e => {
    e.preventDefault();
    const input = document.getElementById('navSearchInput');
    const q = input.value.trim();
    if (!navSearchForm.classList.contains('open')) {
      navSearchForm.classList.add('open');
      input.focus();
      return;
    }
    if (q) {
      const target = `#/search?q=${encodeURIComponent(q)}`;
      if (location.hash === target) renderSearch(q); else location.hash = target;
    }
  });
  document.getElementById('navSearchInput')?.addEventListener('blur', e => {
    if (!e.currentTarget.value.trim()) navSearchForm?.classList.remove('open');
  });
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    const { error } = await sb.auth.signOut();
    if (error) alert(error.message);
    location.hash = '#/';
  });
  refreshNotificationBadge();
  renderTabs();
}

async function refreshNotificationBadge() {
  const badge = document.getElementById('navNotifBadge');
  if (!badge) return;
  if (!currentUser || !sb) { badge.hidden = true; return; }
  const { count, error } = await sb.from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', currentUser.id).is('read_at', null);
  if (error || !count) { badge.hidden = true; return; }
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.hidden = false;
}

async function refreshAdminAccess() {
  if (!currentUser || !sb) { isCurrentUserAdmin = false; return; }
  const checkedUserId = currentUser.id;
  const { data, error } = await sb.rpc('is_current_user_admin');
  if (currentUser?.id !== checkedUserId) return;
  isCurrentUserAdmin = !error && data === true;
  if (nav) setNav();
}

function renderHome() {
  app.innerHTML = `
    <section class="hero hero-split">
      <div class="hero-text">
      <div class="eyebrow">Eserlerin buluşma noktası</div>
      <h1>Her eser bir<br>halka oluşturur.</h1>
      <p class="subtitle">Yazını, çizimini, fotoğrafını, videonu, müziğini paylaş; topluluklarla buluş. Halka’da her eserin bir yeri var.</p>
      ${currentUser ? '<button class="btn primary" id="heroCreateBtn" type="button">Eserini paylaş →</button>' : '<a class="btn primary" href="#/auth?signup">Halka’ya katıl →</a>'}
      </div>
      <div class="hero-art"><svg class="mira-svg mira-float mira-hero" viewBox="0 0 220 220" role="img" aria-label="Çember, Halka maskotu"><use href="#miraArt"/></svg></div>
    </section>
    <div id="continueReadingHome"></div>
    <div id="streakHome"></div>
    <div id="themeHome"></div>
    <div id="storyBar"></div>
    <section class="top-posts-shell">
      <div class="section-head"><div><div class="eyebrow">Öne çıkanlar</div><h2>En çok konuşulan eserler</h2></div>
        <div class="chips" id="topPeriodChips">
          <button class="chip ${topPeriod === 'day' ? 'on' : ''}" data-period="day" type="button">Günün</button>
          <button class="chip ${topPeriod === 'month' ? 'on' : ''}" data-period="month" type="button">Ayın</button>
          <button class="chip ${topPeriod === 'year' ? 'on' : ''}" data-period="year" type="button">Yılın</button>
        </div>
      </div>
      <div id="topPosts">${loadingBlock('Öne çıkanlar hazırlanıyor…')}</div>
    </section>
    <section class="home-feed-shell">
      <div class="section-head home-feed-head"><div><div class="eyebrow">Topluluktan</div><h2>Yeni eserler keşfet</h2></div>${currentUser ? '<a class="btn ghost" href="#/profile">Kaydettiklerime git</a>' : ''}</div>
      <div class="searchbar">
        <input type="text" id="searchInput" placeholder="Eserlerde ara…" value="${esc(feedSearch)}">
        <select class="sortselect" id="sortSelect">
          <option value="new" ${feedSort === 'new' ? 'selected' : ''}>En yeni</option>
          <option value="liked" ${feedSort === 'liked' ? 'selected' : ''}>En çok beğenilen</option>
        </select>
        <button class="btn ghost" id="refreshBtn">Yenile ↻</button>
        <button class="btn ghost" id="randomPostBtn" title="Rastgele bir eser aç">🎲 Şansıma</button>
        <button class="chip ${feedCritique ? 'on' : ''}" id="critiqueChip" type="button">🎯 Eleştiri bekleyenler</button>
      </div>
      <div id="feed"><div class="loading"><div class="spinner-container"><div class="spinner-rings"></div><span>Eserler yükleniyor…</span></div></div></div>
    </section>
  `;
  document.getElementById('heroCreateBtn')?.addEventListener('click', () => {
    const plusBtn = document.querySelector('[data-menu="plus"]');
    const panel = document.getElementById('menu-plus');
    if (plusBtn && panel) { panel.hidden = false; plusBtn.setAttribute('aria-expanded', 'true'); }
  });
  document.getElementById('refreshBtn').addEventListener('click', loadFeed);
  document.getElementById('critiqueChip').addEventListener('click', () => {
    feedCritique = !feedCritique;
    document.getElementById('critiqueChip').classList.toggle('on', feedCritique);
    loadFeed();
  });
  document.getElementById('randomPostBtn').addEventListener('click', async () => {
    const btn = document.getElementById('randomPostBtn');
    btn.disabled = true;
    const { data } = await sb.from('posts').select('id').limit(300);
    btn.disabled = false;
    const pool = data || [];
    if (!pool.length) return;
    location.hash = `#/read/${encodeURIComponent(pool[Math.floor(Math.random() * pool.length)].id)}`;
  });
  document.getElementById('sortSelect').addEventListener('change', e => {
    feedSort = e.target.value;
    loadFeed();
  });
  document.getElementById('searchInput').addEventListener('input', e => {
    feedSearch = e.target.value.toLowerCase().trim();
    loadFeed();
  });
  document.getElementById('topPeriodChips').querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', () => {
    topPeriod = chip.dataset.period;
    chip.parentElement.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === chip));
    loadTopPosts();
  }));
  loadTopPosts();
  loadFeed();
  loadContinueReading();
  loadStories();
  loadStreakCard();
  loadThemeCard();
}

async function loadThemeCard() {
  const box = document.getElementById('themeHome');
  if (!box) return;
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await sb.from('weekly_themes').select('*')
    .eq('active', true).lte('starts_on', today).gte('ends_on', today)
    .order('starts_on', { ascending: false }).limit(1).maybeSingle();
  if (!data) { box.innerHTML = ''; return; }
  const { count } = await sb.from('posts').select('id', { count: 'exact', head: true }).eq('theme_id', data.id);
  box.innerHTML = `
    <div class="card theme-card">
      <div class="eyebrow">🎨 Bu haftanın teması</div>
      <h3 style="margin:6px 0">${esc(data.title)}</h3>
      ${data.prompt ? `<p class="small" style="margin:0 0 8px">${esc(data.prompt)}</p>` : ''}
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span class="small">${count || 0} eser katıldı</span>
        ${currentUser ? `<a class="btn small" href="#/write?kind=blog&theme=${encodeURIComponent(data.id)}">Temayla yaz</a>` : ''}
        <a class="btn ghost small" href="#/section/kesfet?theme=${encodeURIComponent(data.id)}">Katılanları gör</a>
      </div>
    </div>`;
}

async function loadStreakCard() {
  const box = document.getElementById('streakHome');
  if (!box) return;
  if (!currentUser) { box.innerHTML = ''; return; }
  const { data } = await sb.rpc('production_streak', { target: currentUser.id });
  const streak = Number(data?.streak || 0);
  const todayIso = new Date().toISOString().slice(0, 10);
  const known = JSON.parse(localStorage.getItem('halkaStreak') || 'null');
  box.innerHTML = streak > 0
    ? `<div class="card streak-card">🔥 <strong>${streak} gündür üretiyorsun</strong><span class="small"> — bugün de bir şey paylaşırsan seri büyür.</span></div>`
    : '';
  localStorage.setItem('halkaStreak', JSON.stringify({ streak, date: todayIso }));
  if (streak > 0 && data?.last_date === todayIso && streak > (known?.streak || 0)) {
    cemberCelebrate(`Bugün de ürettin! Seri ${streak} güne çıktı — yarın da devam edersen bu tempo efsane olur. 🔥`);
  }
}

let storyGroups = [];
async function loadStories() {
  const box = document.getElementById('storyBar');
  if (!box) return;
  if (currentUser && !sessionStorage.getItem('halkaStoryPurged')) {
    sessionStorage.setItem('halkaStoryPurged', '1');
    sb.rpc('purge_expired_stories').then(() => {});
  }
  const { data: stories } = await sb.from('stories')
    .select('id,user_id,image_path,body,created_at')
    .order('created_at', { ascending: false }).limit(150);
  const rows = stories || [];
  if (!rows.length && !currentUser) { box.innerHTML = ''; return; }
  const userIds = [...new Set(rows.map(s => s.user_id))];
  const { data: profs } = userIds.length
    ? await sb.from('profiles').select('id,username,display_name,avatar_path').in('id', userIds)
    : { data: [] };
  const profMap = Object.fromEntries((profs || []).map(p => [p.id, p]));
  const groups = new Map();
  rows.forEach(s => {
    if (!groups.has(s.user_id)) groups.set(s.user_id, []);
    groups.get(s.user_id).push(s);
  });
  storyGroups = [...groups.entries()]
    .map(([uid, list]) => ({ profile: profMap[uid], user_id: uid, stories: list }))
    .sort((a, b) => (a.user_id === currentUser?.id ? -1 : b.user_id === currentUser?.id ? 1 : new Date(b.stories[0].created_at) - new Date(a.stories[0].created_at)));
  box.innerHTML = `<div class="story-bar">${
    currentUser ? `<button class="story-circle story-add" type="button" title="Story ekle"><span class="story-ring">＋</span><span class="small">Story'n</span></button>` : ''
  }${storyGroups.map((g, i) => `
    <button class="story-circle" type="button" data-g="${i}" title="${esc(displayName(g.profile))}">
      <span class="story-ring">${initials(displayName(g.profile))}</span>
      <span class="small">${esc(displayName(g.profile).split(' ')[0])}</span>
    </button>`).join('')}</div>`;
  box.querySelector('.story-add')?.addEventListener('click', openStoryCreator);
  box.querySelectorAll('.story-circle[data-g]').forEach(el => el.addEventListener('click', () => openStoryViewer(Number(el.dataset.g))));
}

async function storyImageUrl(path) {
  if (!path) return '';
  const { data } = await sb.storage.from('post-media').createSignedUrl(path, 3600);
  const s = data?.signedUrl || '';
  return s ? (/^https?:/.test(s) ? s : `${SUPABASE_URL}/storage/v1${s}`) : '';
}

function openStoryCreator() {
  if (!currentUser) { location.hash = '#/auth?login'; return; }
  document.getElementById('storyModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'storyModal';
  modal.className = 'badge-modal-backdrop';
  modal.innerHTML = `
    <div class="card badge-modal" role="dialog" aria-label="Story ekle" style="text-align:left">
      <button class="badge-modal-close" type="button" aria-label="Kapat">✕</button>
      <h3 style="text-align:center">Story paylaş</h3>
      <p class="small" style="text-align:center">Story'ler 24 saat sonra kaybolur.</p>
      <div class="field"><label>Bir görsel paylaş</label><input id="storyImage" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></div>
      <div class="field"><label for="storyText">veya kısa bir yazı (isteğe bağlı)</label>
        <textarea id="storyText" maxlength="500" placeholder="Ne üretiyorsun bugün?"></textarea></div>
      <button class="btn primary" id="storyPublishBtn" type="button" style="width:100%">Paylaş</button>
      <div id="storyMessage" class="message" aria-live="polite"></div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  modal.querySelector('.badge-modal-close').addEventListener('click', close);
  modal.querySelector('#storyPublishBtn').addEventListener('click', async () => {
    let file = document.getElementById('storyImage').files?.[0] || null;
    const body = document.getElementById('storyText').value.trim();
    const msgEl = document.getElementById('storyMessage');
    if (!file && !body) return setSettingsMessage(msgEl, 'Bir görsel seç veya birkaç satır yaz.', true);
    if (file && (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024)) {
      return setSettingsMessage(msgEl, 'Görsel JPG, PNG, WebP veya GIF olmalı ve 10 MB’ı aşmamalı.', true);
    }
    const btn = modal.querySelector('#storyPublishBtn');
    btn.disabled = true;
    setSettingsMessage(msgEl, 'Yükleniyor…');
    file = await compressImage(file);
    let imagePath = null;
    if (file) {
      const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' })[file.type];
      imagePath = `${currentUser.id}/stories/${crypto.randomUUID()}.${ext}`;
      const up = await sb.storage.from('post-media').upload(imagePath, file, { contentType: file.type, upsert: false });
      if (up.error) { btn.disabled = false; return setSettingsMessage(msgEl, 'Görsel yüklenemedi: ' + up.error.message, true); }
    }
    const { error } = await sb.from('stories').insert({ user_id: currentUser.id, image_path: imagePath, body });
    if (error) {
      if (imagePath) await sb.storage.from('post-media').remove([imagePath]);
      btn.disabled = false;
      return setSettingsMessage(msgEl, 'Story paylaşılamadı: ' + error.message, true);
    }
    close();
    loadStories();
  });
}

let storyTimer = null;
function openStoryViewer(startIdx) {
  document.getElementById('storyViewer')?.remove();
  clearTimeout(storyTimer);
  let gi = startIdx, si = 0;
  const viewer = document.createElement('div');
  viewer.id = 'storyViewer';
  viewer.className = 'story-viewer';
  document.body.appendChild(viewer);
  viewer.addEventListener('click', e => { if (e.target === viewer) closeViewer(); });

  const closeViewer = () => { clearTimeout(storyTimer); viewer.remove(); };
  const show = async () => {
    clearTimeout(storyTimer);
    const group = storyGroups[gi];
    if (!group) return closeViewer();
    const story = group.stories[si];
    if (!story) { gi++; si = 0; return show(); }
    const isMine = currentUser && story.user_id === currentUser.id;
    const imgUrl = await storyImageUrl(story.image_path);
    const ago = Math.round((Date.now() - new Date(story.created_at).getTime()) / 60000);
    const agoText = ago < 60 ? `${ago} dk` : `${Math.round(ago / 60)} sa`;
    viewer.innerHTML = `
      <div class="story-frame">
        <div class="story-progress">${group.stories.map((_, i) => `<span class="${i < si ? 'done' : i === si ? 'live' : ''}"></span>`).join('')}</div>
        <div class="story-head">
          <strong>${esc(displayName(group.profile))}</strong><span class="small">${agoText} önce</span>
          ${isMine ? '<button class="story-del" type="button" title="Story\'i sil">🗑</button>' : ''}
          <button class="story-close" type="button" aria-label="Kapat">✕</button>
        </div>
        <div class="story-body">
          ${imgUrl ? `<img src="${esc(imgUrl)}" alt="Story">` : ''}
          ${story.body ? `<div class="story-text">${esc(story.body)}</div>` : ''}
        </div>
        <button class="story-nav prev" type="button" aria-label="Önceki">‹</button>
        <button class="story-nav next" type="button" aria-label="Sonraki">›</button>
      </div>`;
    viewer.querySelector('.story-close').addEventListener('click', closeViewer);
    viewer.querySelector('.prev').addEventListener('click', () => { if (si > 0) si--; else if (gi > 0) { gi--; si = (storyGroups[gi].stories.length - 1); } show(); });
    viewer.querySelector('.next').addEventListener('click', () => { si++; show(); });
    viewer.querySelector('.story-del')?.addEventListener('click', async () => {
      await sb.from('stories').delete().eq('id', story.id);
      group.stories.splice(si, 1);
      if (!group.stories.length) { storyGroups.splice(gi, 1); loadStories(); }
      if (!storyGroups.length) return closeViewer();
      if (si >= (storyGroups[gi]?.stories.length || 0)) { si = 0; }
      show();
    });
    storyTimer = setTimeout(() => { si++; show(); }, 6000);
  };
  show();
}

async function loadContinueReading() {
  const box = document.getElementById('continueReadingHome');
  if (!box) return;
  if (!currentUser) { box.innerHTML = ''; return; }
  const { data } = await sb.from('reading_progress')
    .select('post_id,chapter_index,updated_at')
    .eq('user_id', currentUser.id)
    .order('updated_at', { ascending: false }).limit(3);
  const rows = (data || []).filter(r => r.chapter_index > 0);
  if (!rows.length) { box.innerHTML = ''; return; }
  const { data: posts } = await sb.from('posts').select('id,title,kind').in('id', rows.map(r => r.post_id));
  const postMap = Object.fromEntries((posts || []).map(p => [p.id, p]));
  const items = rows.filter(r => postMap[r.post_id]);
  if (!items.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<section class="card continue-card"><div class="eyebrow">Okumaya devam et</div>${items.map(r => {
    const p = postMap[r.post_id];
    return `<a class="continue-item" href="#/read/${encodeURIComponent(p.id)}">
      <strong>${esc(p.title || 'Başlıksız eser')}</strong>
      <span class="small">${r.chapter_index + 1}. bölüme kadar okudun · ${esc(formatDate(r.updated_at))}</span></a>`;
  }).join('')}</section>`;
}

async function renderSearch(rawQuery) {
  const q = String(rawQuery || '').trim();
  app.innerHTML = `
    <section class="hero" style="padding:0 0 16px"><div class="eyebrow">Arama</div><h1 style="font-size:38px">Halka'da ara</h1>
      <form id="searchPageForm" class="searchbar" style="margin-top:14px">
        <input type="search" id="searchPageInput" maxlength="80" value="${esc(q)}" placeholder="Kullanıcı, eser, topluluk veya #hashtag ara…" autofocus>
        <button class="btn primary" type="submit">Ara</button>
      </form>
    </section>
    <div id="searchResults">${q ? loadingBlock('Aranıyor…') : '<div class="empty">Ne aradığını yaz: bir kullanıcı adı, eser başlığı, topluluk veya #hashtag.</div>'}</div>`;
  const searchInput = document.getElementById('searchPageInput');
  searchInput?.focus();
  searchInput?.setSelectionRange(searchInput.value.length, searchInput.value.length);
  document.getElementById('searchPageForm').addEventListener('submit', e => {
    e.preventDefault();
    const next = searchInput.value.trim();
    if (!next) return;
    const target = `#/search?q=${encodeURIComponent(next)}`;
    if (location.hash === target) renderSearch(next); else location.hash = target;
  });
  if (!q) return;

  const box = document.getElementById('searchResults');
  const { data, error } = await sb.rpc('search_halka', { q: q.replace(/^#+/, '') });
  if (!document.getElementById('searchResults') || document.getElementById('searchPageInput')?.value.trim() !== q) return;
  if (error) {
    box.innerHTML = `<div class="empty">Arama yapılamadı.<br><span class="small">${esc(error.message)}</span></div>`;
    return;
  }
  const users = data?.users || [];
  const posts = data?.posts || [];
  const communities = data?.communities || [];
  if (!users.length && !posts.length && !communities.length) {
    box.innerHTML = `<div class="empty">"${esc(q)}" için sonuç bulunamadı.</div>`;
    return;
  }
  const authorIds = [...new Set(posts.map(p => p.author_id).filter(Boolean))];
  const { data: authors } = authorIds.length ? await sb.from('profiles').select('id,username,display_name').in('id', authorIds) : { data: [] };
  const authorMap = Object.fromEntries((authors || []).map(a => [a.id, a]));
  box.innerHTML = `
    ${users.length ? `<section><div class="section-head"><h2>Kullanıcılar</h2></div>${users.map(u => `
      <article class="card search-hit"><a class="search-hit-main" href="#/user/${encodeURIComponent(u.id)}">
        <strong>${esc(u.display_name || 'Halka kullanıcısı')}</strong> <span class="small">@${esc(u.username || '')}</span>
      </a><span class="small">${u.last_active_at ? `Son görülme: ${esc(formatDate(u.last_active_at))}` : ''}</span></article>`).join('')}</section>` : ''}
    ${posts.length ? `<section><div class="section-head"><h2>Eserler</h2></div>${posts.map(p => `
      <article class="card search-hit"><a class="search-hit-main" href="#/read/${encodeURIComponent(p.id)}">
        <strong>${esc(p.title || 'Başlıksız eser')}</strong>
      </a><span class="small">${esc(quickTypeLabel(p))} · ${esc(displayName(authorMap[p.author_id]))} · ${esc(formatDate(p.created_at))}</span>
      ${(p.tags || []).length ? `<div class="post-tags">${p.tags.slice(0, 5).map(t => `<a class="tag" href="#/search?q=${encodeURIComponent('#' + t)}">#${esc(t)}</a>`).join('')}</div>` : ''}</article>`).join('')}</section>` : ''}
    ${communities.length ? `<section><div class="section-head"><h2>Topluluklar</h2></div>${communities.map(c => `
      <article class="card search-hit"><a class="search-hit-main" href="#/topluluk/${encodeURIComponent(c.id)}">
        <strong style="color:${esc(c.color || '#D4537E')}">${esc(c.name)}</strong>
      </a><span class="small">${esc((c.description || '').slice(0, 120))}</span></article>`).join('')}</section>` : ''}
  `;
}

let topPeriod = 'day';
async function loadTopPosts() {
  const box = document.getElementById('topPosts');
  if (!box) return;
  const { data, error } = await sb.rpc('top_posts', { period: topPeriod, result_limit: 6 });
  if (error) { box.innerHTML = ''; return; }
  const posts = (data || []);
  if (!posts.length) {
    box.innerHTML = `<div class="empty" style="padding:18px">${topPeriod === 'day' ? 'Son 24 saatte' : topPeriod === 'month' ? 'Son 30 günde' : 'Bu yıl'} öne çıkan eser yok — seninki ilk olabilir.</div>`;
    return;
  }
  const authorIds = [...new Set(posts.map(p => p.author_id))];
  const { data: authors } = authorIds.length ? await sb.from('profiles').select('id,username,display_name').in('id', authorIds) : { data: [] };
  const authorMap = Object.fromEntries((authors || []).map(a => [a.id, a]));
  box.innerHTML = `<div class="top-posts-strip">${posts.map((p, i) => `
    <a class="top-post-card" href="#/read/${encodeURIComponent(p.id)}">
      <span class="top-post-rank">${i + 1}</span>
      <div class="top-post-body">
        <div class="small">${esc(quickTypeLabel(p))}</div>
        <strong>${esc(p.title || 'Başlıksız eser')}</strong>
        <div class="meta">${esc(displayName(authorMap[p.author_id]))} · ❤️ ${Number(p.like_count || 0)} · 👁 ${Number(p.view_count || 0)}</div>
      </div>
    </a>`).join('')}</div>`;
}

const FEED_PAGE = 24;
let feedOffset = 0;
let feedHasMore = false;
let feedLoading = false;

async function loadFeed(append = false) {
  const feed = document.getElementById('feed');
  if (!feed || feedLoading) return;
  feedLoading = true;
  if (!append) feedOffset = 0;

  let query = sb.from('posts').select('*')
    .order('created_at', { ascending: false })
    .range(feedOffset, feedOffset + FEED_PAGE - 1);
  if (feedSearch) {
    const term = feedSearch.replace(/[%(),.*\\]/g, '').slice(0, 60);
    if (term) query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
  }
  if (feedCritique) query = query.eq('critique_wanted', true);
  const { data: posts, error } = await query;
  feedLoading = false;
  if (error) {
    feed.innerHTML = `<div class="empty">Eserler yüklenemedi.<br><span class="small">${esc(error.message)}</span></div>`;
    return;
  }
  feedHasMore = (posts || []).length === FEED_PAGE;
  const newPosts = await attachBookCovers(posts || []);
  await signPostMedia(newPosts);
  cachedPosts = append ? cachedPosts.concat(newPosts) : newPosts;

  const ids = [...new Set(cachedPosts.map(p => p.author_id).filter(Boolean))];
  let profiles = [];
  if (ids.length) {
    const result = await sb.from('profiles').select('id,username,display_name').in('id', ids);
    profiles = result.data || [];
  }
  const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));

  const postIds = cachedPosts.map(p => p.id);
  let likesData = [];
  let likedPostIds = new Set();
  let savedPostIds = new Set();
  if (postIds.length) {
    const likesResult = await sb.from('likes').select('post_id').in('post_id', postIds);
    likesData = likesResult.data || [];
    if (currentUser) {
      const [userLikesResult, savedPostsResult] = await Promise.all([
        sb.from('likes').select('post_id').eq('user_id', currentUser.id).in('post_id', postIds),
        sb.from('saved_posts').select('post_id').eq('user_id', currentUser.id).in('post_id', postIds)
      ]);
      likedPostIds = new Set((userLikesResult.data || []).map(like => like.post_id));
      savedPostIds = new Set((savedPostsResult.data || []).map(saved => saved.post_id));
    }
  }
  const likeCount = {};
  likesData.forEach(l => { likeCount[l.post_id] = (likeCount[l.post_id] || 0) + 1; });

  let filtered = cachedPosts;

  if (feedSort === 'liked') {
    filtered = [...filtered].sort((a, b) => (likeCount[b.id] || 0) - (likeCount[a.id] || 0));
  }

  if (!filtered.length) {
    feed.innerHTML = feedSearch
      ? `<div class="empty">"${esc(feedSearch)}" için sonuç bulunamadı.</div>`
      : `<div class="empty">Henüz burada bir eser yok.<br>İlk eseri sen paylaşabilirsin.</div>`;
    return;
  }

  feed.innerHTML = `<div class="home-feed-grid">${filtered.map(post => {
    const profile = profileMap[post.author_id];
    const title = post.title || 'Başlıksız eser';
    const author = displayName(profile);
    const likes = likeCount[post.id] || 0;
    const isLiked = likedPostIds.has(post.id);
    const isSaved = savedPostIds.has(post.id);
    return `
      <article class="card feed-card">
        <div class="meta">
          <span>${esc(quickTypeLabel(post))}</span>
          <span>· ${esc(formatDate(post.created_at))}</span>
          <span>· ${Number(post.view_count || 0)} görüntülenme</span>
          ${post.critique_wanted ? '<span class="critique-badge">🎯 Eleştiri bekliyor</span>' : ''}
        </div>
        ${postCoverHTML(post)}
        ${mediaHTML(post)}
        <h3><a href="#/read/${encodeURIComponent(post.id)}">${esc(title)}</a></h3>
        <div class="post-tags">${hashtagHTML(post)}</div>
        <p>${esc(post.description || 'Bu eser için henüz bir açıklama eklenmemiş.')}</p>
        <div class="meta">${!post.type || post.type === 'writing' ? 'Yazar' : 'Paylaşan'}: ${post.pen_name ? `<span title="Kalem adı">✒️ ${esc(post.pen_name)}</span>` : `<a href="#/user/${encodeURIComponent(post.author_id)}">${esc(author)}</a>`}</div>
        <div class="post-actions">
          <button class="like-btn ${isLiked ? 'liked' : ''}" data-post-id="${esc(post.id)}" aria-pressed="${isLiked}"><span class="heart">${isLiked ? '❤️' : '🤍'}</span> <span class="like-count">${likes}</span></button>
          <a class="comment-toggle" href="#/read/${encodeURIComponent(post.id)}">💬 Yorumlar</a>
          ${saveButtonHTML(post.id, isSaved)}
        </div>
      </article>`;
  }).join('')}</div>${
    feedHasMore ? '<div style="text-align:center;padding:14px"><button class="btn ghost" id="loadMoreBtn" type="button">Daha fazla eser yükle</button></div>' : ''
  }`;

  feed.querySelectorAll('.like-btn').forEach(btn => {
    btn.addEventListener('click', () => handleLike(btn));
  });
  document.getElementById('loadMoreBtn')?.addEventListener('click', () => {
    feedOffset += FEED_PAGE;
    loadFeed(true);
  });
  bindSaveButtons(feed);
}

async function handleLike(btn) {
  if (!currentUser) { location.hash = '#/auth?signup'; return; }
  const postId = btn.dataset.postId;
  const isLiked = btn.classList.contains('liked');
  btn.disabled = true;

  if (isLiked) {
    const { error } = await sb.from('likes').delete().eq('post_id', postId).eq('user_id', currentUser.id);
    if (error) { btn.disabled = false; return alert(error.message); }
  } else {
    const { error } = await sb.from('likes').insert({ post_id: postId, user_id: currentUser.id });
    if (error) { btn.disabled = false; return alert(error.message); }
  }
  btn.disabled = false;
  await loadFeed();
}

function saveButtonHTML(postId, isSaved = false) {
  return `<button class="save-btn ${isSaved ? 'saved' : ''}" data-post-id="${esc(postId)}" aria-pressed="${isSaved}" title="${isSaved ? 'Kaydedilenlerden çıkar' : 'Daha sonra okumak için kaydet'}"><span aria-hidden="true">${isSaved ? '◆' : '◇'}</span> <span>${isSaved ? 'Kaydedildi' : 'Kaydet'}</span></button>`;
}

async function openCollectionPicker(postId) {
  document.getElementById('collectionModal')?.remove();
  const [{ data: cols }, { data: inItems }] = await Promise.all([
    sb.from('collections').select('id,name').eq('user_id', currentUser.id).order('name'),
    sb.from('collection_items').select('collection_id').eq('post_id', postId)
  ]);
  const inSet = new Set((inItems || []).map(i => i.collection_id));
  const modal = document.createElement('div');
  modal.id = 'collectionModal';
  modal.className = 'badge-modal-backdrop';
  modal.innerHTML = `
    <div class="card badge-modal" role="dialog" aria-label="Koleksiyon seçici">
      <button class="badge-modal-close" type="button" aria-label="Kapat">✕</button>
      <h3>📚 Koleksiyonlarım</h3>
      <div class="collection-list">
        ${(cols || []).length ? cols.map(c => `
          <div class="collection-row">
            <span>${esc(c.name)}</span>
            <button class="btn ghost small collection-toggle" data-col="${esc(c.id)}" type="button">${inSet.has(c.id) ? '✓ Eklendi' : 'Ekle'}</button>
          </div>`).join('') : '<div class="empty">Henüz koleksiyonun yok.</div>'}
      </div>
      <form id="newCollectionForm" style="display:flex;gap:8px;margin-top:12px">
        <input id="newCollectionName" maxlength="60" placeholder="Yeni koleksiyon adı" style="flex:1">
        <button class="btn primary small" type="submit">Oluştur</button>
      </form>
      <div id="collectionMessage" class="message" aria-live="polite"></div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  modal.querySelector('.badge-modal-close').addEventListener('click', close);
  modal.querySelectorAll('.collection-toggle').forEach(btn => btn.addEventListener('click', async () => {
    const colId = btn.dataset.col;
    const inside = btn.textContent.trim() === '✓ Eklendi';
    const res = inside
      ? await sb.from('collection_items').delete().eq('collection_id', colId).eq('post_id', postId)
      : await sb.from('collection_items').insert({ collection_id: colId, post_id: postId });
    if (res.error) { setSettingsMessage(document.getElementById('collectionMessage'), res.error.message, true); return; }
    btn.textContent = inside ? 'Ekle' : '✓ Eklendi';
  }));
  modal.querySelector('#newCollectionForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('newCollectionName').value.trim();
    if (!name) return;
    const { error } = await sb.from('collections').insert({ user_id: currentUser.id, name });
    if (error) { setSettingsMessage(document.getElementById('collectionMessage'), 'Koleksiyon oluşturulamadı: ' + error.message, true); return; }
    close();
    openCollectionPicker(postId);
  });
}

async function renderCollections() {
  if (!currentUser) { location.hash = '#/auth?login'; return; }
  app.innerHTML = loadingBlock('Koleksiyonlar yükleniyor…');
  const { data: cols, error } = await sb.from('collections').select('*').eq('user_id', currentUser.id).order('name');
  if (error) { app.innerHTML = `<div class="empty">Koleksiyonlar yüklenemedi.<br><span class="small">${esc(error.message)}</span></div>`; return; }
  const colIds = (cols || []).map(c => c.id);
  const { data: items } = colIds.length
    ? await sb.from('collection_items').select('collection_id,post_id,posts:post_id(id,title,type,kind,author_id)').in('collection_id', colIds)
    : { data: [] };
  const itemsByCol = new Map();
  (items || []).forEach(i => {
    if (!i.posts) return;
    if (!itemsByCol.has(i.collection_id)) itemsByCol.set(i.collection_id, []);
    itemsByCol.get(i.collection_id).push(i.posts);
  });
  const typeIcon = { writing: '✍️', drawing: '🎨', photo: '📷', video: '🎬', music: '🎵' };
  app.innerHTML = `
    <section class="hero" style="padding-bottom:8px"><div class="eyebrow">HALKA</div><h1>Koleksiyonlarım</h1><p class="subtitle">Kaydettiğin eserleri tematik listelerde topla. Listeler yalnızca sana görünür.</p></section>
    <section class="card">
      <form id="collectionsCreateForm" style="display:flex;gap:8px">
        <input id="collectionsCreateName" maxlength="60" placeholder="Yeni koleksiyon adı (örn. İlham, Okunacaklar)" style="flex:1">
        <button class="btn primary" type="submit">Oluştur</button>
      </form>
      <div id="collectionsMessage" class="message" aria-live="polite"></div>
    </section>
    ${(cols || []).length ? cols.map(c => {
      const colItems = itemsByCol.get(c.id) || [];
      return `<section class="card">
        <div class="section-head"><h2>${esc(c.name)} <span class="small">(${colItems.length})</span></h2><button class="btn ghost small collection-delete" data-col="${esc(c.id)}" type="button">Koleksiyonu sil</button></div>
        ${colItems.length ? colItems.map(p => `
          <div class="collection-item-row">
            <a href="#/read/${encodeURIComponent(p.id)}">${typeIcon[p.type || 'writing'] || '✍️'} ${esc(p.title || 'Başlıksız eser')}</a>
            <button class="chat-msg-act collection-item-del" data-col="${esc(c.id)}" data-post="${esc(p.id)}" type="button" title="Listeden çıkar">🗑</button>
          </div>`).join('') : '<div class="empty">Bu koleksiyonda henüz eser yok. Bir eserin sayfasında "Koleksiyona ekle" düğmesini kullan.</div>'}
      </section>`;
    }).join('') : '<div class="empty">Henüz koleksiyonun yok. Yukarıdan ilk listeni oluştur.</div>'}`;

  document.getElementById('collectionsCreateForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('collectionsCreateName').value.trim();
    if (!name) return;
    const { error: cErr } = await sb.from('collections').insert({ user_id: currentUser.id, name });
    if (cErr) { setSettingsMessage(document.getElementById('collectionsMessage'), 'Koleksiyon oluşturulamadı: ' + cErr.message, true); return; }
    renderCollections();
  });
  document.querySelectorAll('.collection-delete').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Bu koleksiyonu silmek istiyor musun? İçindeki eserler silinmez.')) return;
    const { error: dErr } = await sb.from('collections').delete().eq('id', btn.dataset.col);
    if (dErr) { alert('Koleksiyon silinemedi: ' + dErr.message); return; }
    renderCollections();
  }));
  document.querySelectorAll('.collection-item-del').forEach(btn => btn.addEventListener('click', async () => {
    const { error: dErr } = await sb.from('collection_items').delete().eq('collection_id', btn.dataset.col).eq('post_id', btn.dataset.post);
    if (dErr) { alert('Çıkarılamadı: ' + dErr.message); return; }
    renderCollections();
  }));
}

async function renderOzet() {
  if (!currentUser) { location.hash = '#/auth?login'; return; }
  app.innerHTML = loadingBlock('Halka Özetin hazırlanıyor…');
  const year = new Date().getFullYear();
  const yearStart = new Date(year, 0, 1).toISOString();
  const [postsRes, commentsRes, badgesRes, followersRes] = await Promise.all([
    sb.from('posts').select('id,title,type,kind,view_count,created_at').eq('author_id', currentUser.id).gte('created_at', yearStart),
    sb.from('comments').select('id', { count: 'exact', head: true }).eq('author_id', currentUser.id).gte('created_at', yearStart),
    sb.from('user_badges').select('badge_key,earned_at').eq('user_id', currentUser.id).gte('earned_at', yearStart),
    sb.from('follows').select('follower_id', { count: 'exact', head: true }).eq('followed_id', currentUser.id)
  ]);
  const posts = postsRes.data || [];
  const myPostIds = posts.map(p => p.id);
  const likesRes = myPostIds.length
    ? await sb.from('likes').select('post_id', { count: 'exact', head: true }).in('post_id', myPostIds)
    : { count: 0 };
  const byType = {};
  posts.forEach(p => { byType[p.type || 'writing'] = (byType[p.type || 'writing'] || 0) + 1; });
  const totalViews = posts.reduce((s, p) => s + (p.view_count || 0), 0);
  const topPost = posts.reduce((best, p) => (p.view_count || 0) > (best?.view_count || 0) ? p : best, null);
  const typeIcon = { writing: '✍️', drawing: '🎨', photo: '📷', video: '🎬', music: '🎵' };
  const typeName = { writing: 'Yazı', drawing: 'Çizim', photo: 'Fotoğraf', video: 'Video', music: 'Müzik' };
  const likeCount = likesRes.count || 0;
  const commentCount = commentsRes.count || 0;
  const badgeCount = (badgesRes.data || []).length;
  const missingBadgeKeys = [...new Set((badgesRes.data || []).map(b => b.badge_key).filter(k => !BADGE_DEFS[k]))];
  const { data: customBadgeRows } = missingBadgeKeys.length
    ? await sb.from('custom_badges').select('badge_key,name,icon').in('badge_key', missingBadgeKeys)
    : { data: [] };
  const ozetCustomBadgeMap = Object.fromEntries((customBadgeRows || []).map(b => [b.badge_key, b]));
  const followerCount = followersRes.count || 0;
  const stat = (icon, num, label) => `<div class="ozet-stat"><span class="ozet-icon">${icon}</span><strong>${num}</strong><span>${label}</span></div>`;
  app.innerHTML = `
    <section class="hero ozet-hero"><div class="eyebrow">${year} Halka Özetin</div><h1>Bu yıl neler ürettin?</h1>
      <p class="subtitle">Bir yılın hikâyesi — paylaşmaya değer rakamlar.</p></section>
    <section class="card ozet-grid">
      ${stat('📤', posts.length, 'eser yayınladın')}
      ${stat('👀', totalViews, 'kez görüntülendin')}
      ${stat('❤️', likeCount, 'beğeni aldın')}
      ${stat('💬', commentCount, 'yorum yaptın')}
      ${stat('🏅', badgeCount, 'rozet kazandın')}
      ${stat('🤝', followerCount, 'takipçin oldu')}
    </section>
    ${Object.keys(byType).length ? `<section class="card">
      <div class="eyebrow">Üretim dağılımın</div>
      <div class="ozet-types">${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `
        <div class="ozet-type"><span>${typeIcon[t] || '✍️'}</span><strong>${n}</strong><span class="small">${typeName[t] || t}</span></div>`).join('')}</div>
    </section>` : ''}
    ${topPost ? `<section class="card">
      <div class="eyebrow">Yılın eserin</div>
      <a class="ozet-top" href="#/read/${encodeURIComponent(topPost.id)}">
        <strong>${typeIcon[topPost.type || 'writing'] || '✍️'} ${esc(topPost.title || 'Başlıksız eser')}</strong>
        <span class="small">${topPost.view_count || 0} görüntülenme · ${esc(formatDate(topPost.created_at))}</span></a>
    </section>` : ''}
    ${badgeCount ? `<section class="card">
      <div class="eyebrow">Bu yıl kazandığın rozetler</div>
      <div class="profile-badges">${badgesRes.data.map(b => {
        const def = BADGE_DEFS[b.badge_key];
        const custom = ozetCustomBadgeMap[b.badge_key];
        return `<span class="badge-chip">${def?.icon || custom?.icon || '🏅'} ${esc(def?.name || custom?.name || b.badge_key)}</span>`;
      }).join('')}</div>
    </section>` : ''}
    ${!posts.length ? '<div class="empty">Bu yıl henüz eser paylaşmadın. İlk eserini yayınla, özetin dolsun! 🌸</div>' : ''}
    <div style="text-align:center;margin-top:8px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <button class="btn" id="ozetShareBtn" type="button">🖼️ Kartı görsel olarak indir</button>
      <a class="btn ghost" href="#/profile">Profilime dön</a>
    </div>
    <div id="ozetShareMsg" class="message" style="text-align:center" aria-live="polite"></div>`;

  document.getElementById('ozetShareBtn')?.addEventListener('click', () => {
    const btn = document.getElementById('ozetShareBtn');
    btn.disabled = true;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 800; canvas.height = 1000;
      const ctx = canvas.getContext('2d');
      const grad = ctx.createLinearGradient(0, 0, 800, 1000);
      grad.addColorStop(0, '#1a1816'); grad.addColorStop(1, '#2b2418');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, 800, 1000);
      ctx.strokeStyle = '#E8923C'; ctx.lineWidth = 3;
      ctx.strokeRect(24, 24, 752, 952);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#E8923C'; ctx.font = 'bold 30px Georgia, serif';
      ctx.fillText(`${year} HALKA ÖZETİ`, 400, 90);
      ctx.fillStyle = '#f4efe1'; ctx.font = 'bold 46px Georgia, serif';
      ctx.fillText((currentProfile?.display_name || currentUser.user_metadata?.display_name || 'Halka üyesi').slice(0, 30), 400, 155);
      const rows = [
        ['📤', posts.length, 'eser yayınladı'],
        ['👀', totalViews, 'kez görüntülendi'],
        ['❤️', likeCount, 'beğeni aldı'],
        ['💬', commentCount, 'yorum yaptı'],
        ['🏅', badgeCount, 'rozet kazandı'],
        ['🤝', followerCount, 'takipçisi oldu']
      ];
      rows.forEach(([icon, num, label], i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const x = 200 + col * 400, y = 260 + row * 150;
        ctx.font = '46px serif'; ctx.fillText(icon, x, y);
        ctx.fillStyle = '#f4efe1'; ctx.font = 'bold 52px Georgia, serif'; ctx.fillText(String(num), x, y + 62);
        ctx.fillStyle = '#9a9484'; ctx.font = '20px Inter, sans-serif'; ctx.fillText(label, x, y + 95);
        ctx.fillStyle = '#f4efe1';
      });
      if (topPost) {
        ctx.fillStyle = '#9a9484'; ctx.font = '20px Georgia, serif';
        ctx.fillText('Yılın eseri:', 400, 760);
        ctx.fillStyle = '#f4efe1'; ctx.font = 'bold 30px Georgia, serif';
        ctx.fillText((topPost.title || 'Başlıksız eser').slice(0, 40), 400, 800);
      }
      ctx.strokeStyle = '#E8923C'; ctx.beginPath(); ctx.arc(400, 890, 26, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#9a9484'; ctx.font = '18px Inter, sans-serif';
      ctx.fillText('halka-sosyal.web.app', 400, 960);
      canvas.toBlob(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `halka-ozeti-${year}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      }, 'image/png');
    } catch (err) {
      const msg = document.getElementById('ozetShareMsg');
      if (msg) { msg.textContent = 'Kart oluşturulamadı: ' + err.message; msg.className = 'message error'; }
    } finally { btn.disabled = false; }
  });
}

async function renderRelayList() {
  if (!currentUser) { location.hash = '#/auth?login'; return; }
  app.innerHTML = loadingBlock('Nöbetleşe hikâyeler yükleniyor…');
  const [mineRes, openRes] = await Promise.all([
    sb.from('relay_stories').select('*').or(`host_id.eq.${currentUser.id},partner_id.eq.${currentUser.id}`).order('updated_at', { ascending: false }).limit(30),
    sb.from('relay_stories').select('*').eq('status', 'active').order('updated_at', { ascending: false }).limit(12)
  ]);
  const all = [...(mineRes.data || []), ...(openRes.data || [])];
  const userIds = [...new Set(all.flatMap(s => [s.host_id, s.partner_id]))];
  const { data: profs } = userIds.length
    ? await sb.from('profiles').select('id,username,display_name').in('id', userIds) : { data: [] };
  const profMap = Object.fromEntries((profs || []).map(p => [p.id, p]));
  const rel = s => `${displayName(profMap[s.host_id])} × ${displayName(profMap[s.partner_id])}`;
  const mine = mineRes.data || [];
  const open = (openRes.data || []).filter(s => !mine.some(m => m.id === s.id));
  app.innerHTML = `
    <section class="hero" style="padding-bottom:8px"><div class="eyebrow">Birlikte üretim</div><h1>⚡ Nöbetleşe hikâye</h1>
      <p class="subtitle">Bir ortak seç, sırayla paragraf yazın — hikâyeyi kimsenin tahmin edemeyeceği bir yere taşıyın.</p></section>
    <section class="card">
      <h2>Yeni hikâye başlat</h2>
      <form id="relayStartForm">
        <div class="field"><label for="relayTitle">Hikâye adı</label><input id="relayTitle" maxlength="80" required placeholder="Örn. Kayıp Vapur"></div>
        <div class="field"><label for="relayPartner">Ortağın kullanıcı adı</label><input id="relayPartner" maxlength="40" required placeholder="@olmadan kullanıcı adı"></div>
        <button class="btn primary" type="submit">Davet gönder ve başlat</button>
      </form>
      <div id="relayMessage" class="message" aria-live="polite"></div>
    </section>
    ${mine.length ? `<section class="card"><h2>Katıldıkların</h2>${mine.map(s => `
      <a class="collection-item-row" href="#/relay/${encodeURIComponent(s.id)}">
        <span><strong>${esc(s.title)}</strong> <span class="small">${esc(rel(s))}</span></span>
        <span class="small">${s.status === 'active' ? `🟢 ${s.turn_count} paragraf` : '✅ Tamamlandı'}</span>
      </a>`).join('')}</section>` : ''}
    ${open.length ? `<section class="card"><h2>Devam edenler</h2>${open.map(s => `
      <a class="collection-item-row" href="#/relay/${encodeURIComponent(s.id)}">
        <span><strong>${esc(s.title)}</strong> <span class="small">${esc(rel(s))}</span></span>
        <span class="small">${s.turn_count} paragraf</span>
      </a>`).join('')}</section>` : ''}
  `;
  document.getElementById('relayStartForm').addEventListener('submit', async e => {
    e.preventDefault();
    const title = document.getElementById('relayTitle').value.trim();
    const uname = document.getElementById('relayPartner').value.trim().replace(/^@/, '');
    const msgEl = document.getElementById('relayMessage');
    const { data: partner } = await sb.from('profiles').select('id').eq('username', uname).maybeSingle();
    if (!partner) return setSettingsMessage(msgEl, `"${uname}" adlı kullanıcı bulunamadı.`, true);
    const { data: storyId, error } = await sb.rpc('relay_start', { p_title: title, p_partner: partner.id });
    if (error) return setSettingsMessage(msgEl, error.message, true);
    location.hash = `#/relay/${encodeURIComponent(storyId)}`;
  });
}

let relayRealtime = null;
async function renderRelay(id) {
  app.innerHTML = loadingBlock('Hikâye açılıyor…');
  const { data: story } = await sb.from('relay_stories').select('*').eq('id', id).maybeSingle();
  if (!story) { app.innerHTML = '<div class="empty">Hikâye bulunamadı.</div>'; return; }
  const { data: turns } = await sb.from('relay_turns').select('*').eq('story_id', id).order('seq');
  const ids = [...new Set([story.host_id, story.partner_id, ...(turns || []).map(t => t.author_id)])];
  const { data: profs } = await sb.from('profiles').select('id,username,display_name').in('id', ids);
  const profMap = Object.fromEntries((profs || []).map(p => [p.id, p]));
  const isParticipant = currentUser && (currentUser.id === story.host_id || currentUser.id === story.partner_id);
  const lastAuthor = (turns || []).length ? turns[turns.length - 1].author_id : null;
  const myTurn = story.status === 'active' && isParticipant && lastAuthor !== currentUser.id;
  const partner = currentUser && (story.host_id === currentUser.id ? profMap[story.partner_id] : profMap[story.host_id]);

  app.innerHTML = `
    <section class="hero" style="padding-bottom:8px">
      <div class="eyebrow">⚡ Nöbetleşe hikâye · ${story.status === 'active' ? 'devam ediyor' : 'tamamlandı'}</div>
      <h1>${esc(story.title)}</h1>
      <p class="meta">${esc(displayName(profMap[story.host_id]))} × ${esc(displayName(profMap[story.partner_id]))} · ${(turns || []).length} paragraf</p>
    </section>
    <section class="card">
      <div id="relayTurns">${(turns || []).length ? turns.map(t => `
        <div class="relay-turn ${t.author_id === currentUser?.id ? 'mine' : ''}">
          <p>${esc(t.body)}</p>
          <div class="small relay-meta">${t.seq}. paragraf · ${esc(displayName(profMap[t.author_id]))} · ${esc(formatDate(t.created_at))}</div>
        </div>`).join('') : '<div class="empty">Henüz ilk paragraf yazılmadı.</div>'}</div>
      ${myTurn ? `
        <form id="relayTurnForm" class="chapter-comment-form" style="margin-top:14px">
          <textarea id="relayBody" maxlength="1200" required placeholder="Sıra sende — hikâyeyi devam ettir (en fazla 1200 karakter)"></textarea>
          <button class="btn primary" type="submit">Paragrafı gönder</button>
        </form>` : story.status === 'active' && isParticipant
          ? `<p class="small" style="margin-top:12px">⏳ Sıra ${esc(displayName(partner))} tarafında — bildirim gitti, bekliyor.</p>` : ''}
      ${isParticipant && story.status === 'active' && (turns || []).length ? `<button class="btn ghost small" id="relayFinishBtn" type="button" style="margin-top:10px">Hikâyeyi bitir</button>` : ''}
      ${currentUser?.id === story.host_id ? `<button class="btn ghost small" id="relayDeleteBtn" type="button" style="margin-top:6px">Hikâyeyi sil</button>` : ''}
      <div id="relayTurnMessage" class="message" aria-live="polite"></div>
    </section>`;

  document.getElementById('relayTurnForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const body = document.getElementById('relayBody').value.trim();
    if (!body) return;
    const btn = e.currentTarget.querySelector('button[type="submit"]');
    btn.disabled = true;
    const { error } = await sb.rpc('relay_add_turn', { p_story: id, p_body: body });
    btn.disabled = false;
    if (error) return setSettingsMessage(document.getElementById('relayTurnMessage'), error.message, true);
    renderRelay(id);
  });
  document.getElementById('relayFinishBtn')?.addEventListener('click', async () => {
    if (!confirm('Hikâye tamamlandı olarak işaretlensin mi? Paragraf eklenemeyecek.')) return;
    const { error } = await sb.rpc('relay_finish', { p_story: id });
    if (error) { alert(error.message); return; }
    renderRelay(id);
  });
  document.getElementById('relayDeleteBtn')?.addEventListener('click', async () => {
    if (!confirm('Hikâye ve tüm paragrafları silinecek. Emin misin?')) return;
    const { error } = await sb.rpc('relay_delete', { p_story: id });
    if (error) { alert(error.message); return; }
    location.hash = '#/relay';
  });

  try {
    if (relayRealtime) { sb.removeChannel(relayRealtime); relayRealtime = null; }
    relayRealtime = sb.channel(`relay-${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'relay_turns', filter: `story_id=eq.${id}` }, () => renderRelay(id))
      .subscribe();
  } catch {}
}

function bindSaveButtons(scope = document) {
  scope.querySelectorAll('.save-btn').forEach(button => button.addEventListener('click', () => handleSave(button)));
}

async function handleSave(button) {
  if (!currentUser) { location.hash = '#/auth?signup'; return; }
  const postId = button.dataset.postId;
  const isSaved = button.classList.contains('saved');
  button.disabled = true;
  const result = isSaved
    ? await sb.from('saved_posts').delete().eq('post_id', postId).eq('user_id', currentUser.id)
    : await sb.from('saved_posts').insert({ post_id: postId, user_id: currentUser.id });
  button.disabled = false;
  if (result.error) {
    alert(`Eser ${isSaved ? 'kaydedilenlerden çıkarılamadı' : 'kaydedilemedi'}: ${result.error.message}. Veritabanı güncellemesinin uygulanmış olduğundan emin ol.`);
    return;
  }
  button.classList.toggle('saved', !isSaved);
  button.setAttribute('aria-pressed', String(!isSaved));
  button.title = isSaved ? 'Daha sonra okumak için kaydet' : 'Kaydedilenlerden çıkar';
  button.innerHTML = `<span aria-hidden="true">${isSaved ? '◇' : '◆'}</span> <span>${isSaved ? 'Kaydet' : 'Kaydedildi'}</span>`;
}

function renderAuth(mode = 'signup') {  currentAuthMode = mode;
  const signup = mode === 'signup';
  app.innerHTML = `
    <section class="card form-card">
      <div class="eyebrow">Halka'ya hoş geldin</div>
      <h1 style="font-size:36px">${signup ? 'Aramıza katıl.' : 'Tekrar hoş geldin.'}</h1>
      <p class="subtitle">${signup ? 'Hesabını oluştur ve hikâyeni paylaşmaya başla.' : 'Hesabına giriş yap, kaldığın yerden devam et.'}</p>
      <form id="authForm">
        ${signup ? `
          <div class="field">
            <label for="display_name">Görünen ad</label>
            <input id="display_name" name="display_name" required maxlength="60" autocomplete="name" placeholder="Örn. Adın Soyadın">
            <div class="small">Profilinde ve eserlerinin yanında görünecek ad.</div>
          </div>
          <div class="field">
            <label for="username">Kullanıcı adı</label>
            <input id="username" name="username" required minlength="3" maxlength="20" title="3-20 karakter: harf, rakam ve alt çizgi" autocomplete="username" autocapitalize="none" placeholder="ornek_kullanici">
            <div class="small">Küçük harf, rakam ve alt çizgi kullan.</div>
          </div>
        ` : ''}
        <div class="field">
          <label for="email">E-posta</label>
          <input id="email" name="email" type="email" required autocomplete="email" placeholder="ornek@eposta.com">
        </div>
        <div class="field">
          <label for="password">Şifre</label>
          <input id="password" name="password" type="password" required maxlength="${signup ? '20' : '72'}" ${signup ? 'minlength="8"' : ''} autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="${signup ? '8–20 karakter' : 'Şifren'}">
          ${signup ? '<div class="small">8–20 karakter; harf, rakam ve sembol içermeli.</div>' : ''}
        </div>
        ${signup ? `<div class="field"><label for="passwordConfirm">Şifreyi tekrar yaz</label><input id="passwordConfirm" name="password_confirm" type="password" required minlength="8" maxlength="20" autocomplete="new-password"></div>` : ''}
        ${signup ? `<div class="field" aria-label="Yasal belgeler">${legalCheckboxes()}</div>` : ''}
        <button class="btn primary" style="width:100%" type="submit">${signup ? 'Hesap oluştur' : 'Giriş yap'}</button>
      </form>
      <div class="small" style="text-align:center;margin:14px 0">veya</div>
      ${!signup ? `<div id="oauthLegal" class="field">${legalCheckboxes('oauth_legal')}<div class="small">Sosyal medya veya telefonla devam ederken bu belgeleri kabul etmen gerekir.</div></div>` : ''}
      <div class="oauth-grid" style="display:grid;gap:8px;margin-bottom:12px">
        ${ENABLED_OAUTH_PROVIDERS.map(p => `<button class="btn ghost oauth-btn" data-provider="${p}" type="button">${OAUTH_PROVIDER_NAMES[p]} ile devam et</button>`).join('')}
      </div>
      <div id="phoneAuthSection" ${PHONE_AUTH_ENABLED ? '' : 'hidden'}>
      <hr style="margin:14px 0;border-color:var(--line)">
        <div class="field">
          <label for="phoneNumber">Telefon numarası</label>
          <input id="phoneNumber" type="tel" placeholder="+905551234567" autocomplete="tel">
          <div class="small">Ülke koduyla birlikte yaz: +90…</div>
        </div>
        <button id="phoneSendCodeBtn" class="btn ghost" style="width:100%" type="button">SMS kodu gönder</button>
        <div id="phoneVerifyBox" hidden>
          <div class="field">
            <label for="phoneCode">Doğrulama kodu</label>
            <input id="phoneCode" type="text" inputmode="numeric" maxlength="6" placeholder="123456">
          </div>
          <button id="phoneVerifyBtn" class="btn primary" style="width:100%" type="button">Doğrula ve giriş yap</button>
        </div>
      </div>
      <div id="message" class="message"></div>
      <hr>
      <p class="small">${signup ? 'Zaten hesabın var mı?' : 'Henüz hesabın yok mu?'}
        <a href="#/auth?${signup ? 'login' : 'signup'}">${signup ? 'Giriş yap' : 'Hesap oluştur'}</a>
      </p>
    </section>
  `;

  document.getElementById('authForm').addEventListener('submit', async e => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') || '').trim().toLowerCase();
    const password = String(form.get('password') || '');
    const submit = e.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'İşleniyor…';

    try {
      if (signup) {
        if (!hasLegalConsent(e.currentTarget)) {
          showMessage('Hesap açmak için üç belgeyi de okuyup onaylamalısın.', true);
          return;
        }
        const username = String(form.get('username') || '').trim().toLowerCase();
        const name = String(form.get('display_name') || '').trim();
        if (password.length < 8 || password.length > 20) { showMessage('Şifre 8–20 karakter arasında olmalı.', true); return; }
        if (new TextEncoder().encode(password).length > 72) { showMessage('Bu şifre Supabase sınırını aşıyor. Daha kısa bir şifre seç.', true); return; }
        if (!/[a-z]/i.test(password) || !/\d/.test(password) || !/[^a-z0-9]/i.test(password)) { showMessage('Şifrede en az bir harf, bir rakam ve bir sembol kullan.', true); return; }
        if (password !== String(form.get('password_confirm') || '')) { showMessage('Şifreler eşleşmiyor.', true); return; }
        if (!/^[a-z0-9_]{3,20}$/.test(username)) {
          showMessage('Kullanıcı adı 3–20 karakter olmalı; küçük harf, rakam ve alt çizgi kullan.', true);
          return;
        }
        if (!name) { showMessage('Lütfen bir görünen ad yaz.', true); return; }
        const { data, error } = await sb.auth.signUp({
          email, password,
          options: { data: { username, display_name: name, ...currentLegalMetadata() } }
        });
        if (error) { showMessage(error.message, true); return; }
        if (!data.session) {
          showMessage('Hesabın oluşturuldu. E-posta doğrulaması isteniyorsa gelen kutunu kontrol et. Görünen adın kayıt sırasında kaydedildi.');
          return;
        }
        currentUser = data.user;
        await loadProfile();
        location.hash = '#/';
      } else {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) { showMessage(error.message, true); return; }
        currentUser = data.user;
        await loadProfile();
        if (await requireMfaChallenge()) return;
        location.hash = '#/';
      }
    } catch (err) {
      showMessage(err.message || 'Beklenmeyen bir hata oluştu.', true);
    } finally {
      submit.disabled = false;
      submit.textContent = signup ? 'Hesap oluştur' : 'Giriş yap';
    }
  });

  const startOAuth = async (button, provider) => {
    const consentForm = document.getElementById('authForm');
    if (signup ? !hasLegalConsent(consentForm) : !hasLegalConsent(document.getElementById('oauthLegal'), 'oauth_legal')) {
      showMessage('Devam etmek için üç belgeyi de okuyup onaylamalısın.', true);
      return;
    }
    try { localStorage.setItem('halka_pending_legal_consent', JSON.stringify(currentLegalMetadata())); } catch {}
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Yönlendiriliyor…';
    try {
      const redirectTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
      const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo } });
      if (error) showMessage(error.message, true);
    } catch (err) {
      showMessage(err.message || `${provider} ile giriş başlatılamadı.`, true);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  };
  document.querySelectorAll('.oauth-btn').forEach(btn => btn.addEventListener('click', () => startOAuth(btn, btn.dataset.provider)));

  const phoneMessage = (text, error = false) => { const el = document.getElementById('message'); el.textContent = text; el.className = error ? 'message error' : 'message'; };
  document.getElementById('phoneSendCodeBtn').addEventListener('click', async () => {
    const phone = document.getElementById('phoneNumber').value.trim();
    if (!/^\+[1-9]\d{7,15}$/.test(phone)) { phoneMessage('Geçerli bir telefon numarası yaz. Ülke koduyla birlikte: +90555...', true); return; }
    const btn = document.getElementById('phoneSendCodeBtn');
    btn.disabled = true; btn.textContent = 'Kod gönderiliyor…';
    const { error } = await sb.auth.signInWithOtp({ phone });
    btn.disabled = false; btn.textContent = 'SMS kodu gönder';
    if (error) { phoneMessage('Kod gönderilemedi: ' + error.message, true); return; }
    document.getElementById('phoneVerifyBox').hidden = false;
    phoneMessage('Doğrulama kodu gönderildi.');
  });
  document.getElementById('phoneVerifyBtn').addEventListener('click', async () => {
    const phone = document.getElementById('phoneNumber').value.trim();
    const token = document.getElementById('phoneCode').value.trim();
    if (!phone || !/^\d{6}$/.test(token)) { phoneMessage('6 haneli kodu gir.', true); return; }
    const { data, error } = await sb.auth.verifyOtp({ phone, token, type: 'sms' });
    if (error) { phoneMessage('Doğrulama başarısız: ' + error.message, true); return; }
    currentUser = data.user;
    await loadProfile();
    location.hash = '#/';
  });
}

async function loadProfile() {
  if (!currentUser) { currentProfile = null; return; }
  const { data, error } = await sb.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
  if (error) console.error('Profil yükleme hatası:', error.message);
  currentProfile = data || null;
  try {
    await sb.from('profiles').update({ last_active_at: new Date().toISOString() }).eq('id', currentUser.id);
  } catch {}
}

function renderWrite() {
  if (!currentUser) { location.hash = '#/auth?signup'; return; }
  app.innerHTML = `
    <section class="hero">
      <div class="eyebrow">Yaratıcılığa yer aç</div>
      <h1>Yeni eserin.</h1>
      <p class="subtitle">Bir Blog, Kısa Yazı veya Kitap seç; seçimine uygun yazı iskeletini kullan.</p>
    </section>
    <section class="card">
      <form id="writeForm">
        <div class="field">
          <label for="title">Eserin adı</label>
          <input id="title" name="title" required maxlength="120" placeholder="Hikâyenin adı">
        </div>
        <div class="field">
          <label for="penName">Kalem adı <span class="small">(isteğe bağlı)</span></label>
          <input id="penName" name="pen_name" maxlength="60" placeholder="Boş bırakırsan profil adın görünür">
          <div class="small">Bu eserde profil adın yerine bu isim gösterilir.</div>
        </div>
        <div class="field" style="display:flex;align-items:center;gap:8px">
          <input id="critiqueWanted" name="critique_wanted" type="checkbox" style="width:auto">
          <label for="critiqueWanted" style="margin:0">🎯 Bu esere eleştiri istiyorum — "Eleştiri bekliyor" rozetiyle yayınla</label>
        </div>
        <div class="field" style="display:flex;align-items:center;gap:8px">
          <input id="allowDownload" name="allow_download" type="checkbox" style="width:auto">
          <label for="allowDownload" style="margin:0">⬇️ Bu eserin indirilmesine izin ver</label>
        </div>
        <div class="field">
          <label for="tags">Hashtag’ler</label>
          <input id="tags" name="tags" maxlength="160" list="hashtagSuggestions" placeholder="fantastik, günlük, kitap">
          <datalist id="hashtagSuggestions">${categories.filter(tag => tag !== 'Diğer').map(tag => `<option value="${esc(tagSlug(tag))}">`).join('')}</datalist>
          <div class="small">Virgül veya boşlukla ayır; en fazla 5 hashtag. Örnek: #fantastik #günlük</div>
          <div id="hashtagPreview" class="post-tags" aria-live="polite"></div>
        </div>
        <div class="field">
          <label for="kind">Eser türü</label>
          <select id="kind" name="kind">
            <option value="blog">Blog</option>
            <option value="short">Kısa Yazı</option>
            <option value="book">Kitap</option>
            <option value="manga">Manga</option>
            <option value="light_novel">Light Novel</option>
          </select>
        </div>
        <div class="field">
          <label for="description">Kısa tanıtım</label>
          <textarea id="description" name="description" maxlength="1200" placeholder="Yazını birkaç cümleyle tanıt…"></textarea>
        </div>
        <div id="bookCoverField" class="field book-cover-field" hidden><label for="bookCover">Kitap kapağı</label><input id="bookCover" type="file" accept="image/jpeg,image/png,image/webp"><div class="small">JPG, PNG veya WebP · en fazla 5 MB · veya <button class="btn ghost small" id="coverMakerBtn" type="button">🎨 Kapak oluşturucu</button> ile sıfırdan tasarla</div><img id="bookCoverPreview" class="book-cover-preview" alt="Kitap kapağı önizlemesi"></div>
        <hr>
        <h2 id="writingBodyHeading">Yazı içeriği</h2>
        <p id="writingTemplateHelp" class="small"></p>
        <button class="btn ghost small" id="insertWritingTemplate" type="button">Örnek iskeleti ekle</button>
        <div class="field" id="chapterTitleField">
          <label for="chapter_title">İçerik başlığı</label>
          <input id="chapter_title" name="chapter_title" maxlength="120" placeholder="Yazı">
        </div>
        <div class="field" id="chapterBodyField">
          <label for="chapter_body">Yazı metni</label>
          <div class="rich-tools" id="chapterTools" hidden><button class="btn ghost small" type="button" data-wrap="**">Kalın: **…**</button><button class="btn ghost small" type="button" data-wrap="()">İtalik: (…)</button></div>
          <textarea id="chapter_body" name="chapter_body" required maxlength="50000" placeholder="Yazını buraya yaz…"></textarea>
        </div>
        <div class="field" id="mangaPagesField" hidden>
          <label>Manga sayfaları</label>
          <input id="mangaPageFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple>
          <div class="small">Çizdiğin sayfaları yükle (sırayla okunur) veya panel oluşturucuyla tarayıcıda çiz.</div>
          <button class="btn ghost small" id="panelComposerBtn" type="button">🎨 Panel oluşturucu</button>
          <div id="mangaPagesList" class="manga-page-list"></div>
        </div>
        <button class="btn primary" type="submit">Eseri yayımla</button>
      </form>
      <div id="message" class="message"></div>
    </section>
  `;

  const writingTemplates = {
    blog: {
      title: 'Blog başlığı', titlePlaceholder: 'Örn. Her gün yazma alışkanlığı nasıl kazanılır?',
      description: 'Kısa tanıtım', descriptionPlaceholder: 'Yazının konusunu ve okuyucuya ne sunacağını özetle…',
      heading: 'Blog yazısı', help: 'Blog için kısa yol:\n1. Konuyu anlatan bir başlık seç.\n2. Girişte konuyu ve amacını söyle.\n3. Ana fikrini birkaç bölümde açıkla.\n4. Kısa bir sonuçla bitir.',
      chapterLabel: 'Yazı başlığı', chapterPlaceholder: 'Yazı', bodyLabel: 'Blog metni',
      bodyPlaceholder: 'Girişini yaz, ana fikirlerini açıkla ve kısa bir sonuçla bitir…',
      starter: 'Giriş:\n\nAna fikir 1:\n\nAna fikir 2:\n\nSonuç:'
    },
    short: {
      title: 'Kısa yazının başlığı', titlePlaceholder: 'Kısa ve akılda kalıcı bir başlık seç…',
      description: 'Kısa tanıtım', descriptionPlaceholder: 'İstersen yazı için tek cümlelik bir tanıtım ekle…',
      heading: 'Kısa yazı', help: 'Kısa yazı için:\n1. Tek bir düşünce, anı veya sahne seç.\n2. Başlangıç, gelişme ve bitişi kısa tut.\n3. Son kez okuyup fazlalıkları çıkar.',
      chapterLabel: 'Metin başlığı', chapterPlaceholder: 'Metin', bodyLabel: 'Kısa yazının tamamı',
      bodyPlaceholder: 'Başlangıçtan sona kısa yazını buraya ekle…',
      starter: 'Başlangıç:\n\nGelişme:\n\nBitiş:'
    },
    book: {
      title: 'Kitap adı', titlePlaceholder: 'Kitabının adını yaz…',
      description: 'Kitap tanıtımı', descriptionPlaceholder: 'Arka kapak yazısı gibi kitabını, temasını ve okurunu tanıt…',
      heading: 'İlk bölüm', help: 'Kitaba başlamak için:\n1. Ad ve kısa tanıtım ekle.\n2. İstersen kapak yükle.\n3. İlk bölümün adını ve metnini yaz.\n4. Yayımladıktan sonra yeni bölümler ekleyebilirsin.\n\nBiçim: **kalın**, (italik).',
      chapterLabel: 'Bölüm adı', chapterPlaceholder: '1. Bölüm', bodyLabel: 'İlk bölüm metni',
      bodyPlaceholder: 'Açılış sahnesini kur; karakterleri ve dünyayı okura tanıt…',
      starter: 'Açılış sahnesi:\n\nKarakterler ve mekân:\n\nBölümün sonunda merak unsuru:'
    },
    manga: {
      title: 'Manga adı', titlePlaceholder: 'Manganın adını yaz…',
      description: 'Manga tanıtımı', descriptionPlaceholder: 'Manganın konusunu, kahramanını ve tonunu birkaç cümleyle anlat…',
      heading: 'Manga sayfaları', help: 'Manga görseldir — sayfaları çizilmiş olarak yükle veya panel oluşturucuyla tarayıcıda çiz:\n1. Hazır sayfa görsellerini seç (sırayla okunur).\n2. Ya da 🎨 Panel oluşturucu: şablon seç, panele çiz/görsel koy, konuşma balonu ekle.\n3. Büyük vuruşu sayfa sonuna sakla — sayfa çevirme şoku!\n4. İstersen metin alanını senaryo taslağı için de kullanabilirsin.',
      chapterLabel: 'Senaryo taslağı (isteğe bağlı)', chapterPlaceholder: 'Senaryo', bodyLabel: 'Senaryo / not metni',
      bodyPlaceholder: 'Sayfa 1\n\nPanel 1 — kadraj tasviri…\nKARAKTER: replik\nSFX: …',
      starter: ''
    },
    light_novel: {
      title: 'Light novel adı', titlePlaceholder: 'Eserinin adını yaz…',
      description: 'Tanıtım', descriptionPlaceholder: 'Arka kapak tadında kısa bir tanıtım yaz…',
      heading: 'İlk bölüm', help: 'Light novel, "manganın yazıyla çekilmiş hâli" gibidir:\n1. Hızlı ve okunabilir yaz; uzun tasvir bloklarından kaçın.\n2. Diyalog ağırlıklı git — yaklaşık %70 diyalog, %30 anlatı iyi bir denge.\n3. Birinci tekil anlatıcı ve iç monolog kahramanın sesini güçlendirir.\n4. Bölümü kısa tut ve bir kancayla (cliffhanger / duygu vuruşu) bitir.\n\nBiçim: **kalın**, (italik).',
      chapterLabel: 'Bölüm adı', chapterPlaceholder: '1. Bölüm', bodyLabel: 'İlk bölüm metni',
      bodyPlaceholder: 'Kısa cümlelerle sahneye gir; kahramanın sesiyle diyalog ve içsesi harmanla…',
      starter: 'Açılış: kahramanın içsesiyle günlük bir an ya da olayın ortasına gir.\n\nİlk diyalog: karşılaşma / çatışma kıvılcımı.\n\nGelişme: diyalog ağırlıklı sahne.\n\nKapanış: bölümü bitiren kanca — merak ya da duygu vuruşu.'
    }
  };
  const applyWritingTemplate = kind => {
    const t = writingTemplates[kind] || writingTemplates.blog;
    document.querySelector('label[for="title"]').textContent = t.title;
    document.getElementById('title').placeholder = t.titlePlaceholder;
    document.querySelector('label[for="description"]').textContent = t.description;
    document.getElementById('description').placeholder = t.descriptionPlaceholder;
    document.getElementById('writingBodyHeading').textContent = t.heading;
    document.getElementById('writingTemplateHelp').textContent = t.help;
    const isManga = kind === 'manga';
    document.getElementById('bookCoverField').hidden = !isChapteredKind(kind);
    document.getElementById('chapterTools').hidden = !isChapteredKind(kind);
    document.getElementById('chapter_body').required = !isManga;
    document.getElementById('mangaPagesField').hidden = !isManga;
    document.getElementById('insertWritingTemplate').hidden = isManga;
    document.querySelector('label[for="chapter_title"]').textContent = t.chapterLabel;
    document.getElementById('chapter_title').placeholder = t.chapterPlaceholder;
    document.querySelector('label[for="chapter_body"]').textContent = t.bodyLabel;
    document.getElementById('chapter_body').placeholder = t.bodyPlaceholder;
    document.getElementById('insertWritingTemplate').onclick = () => {
      const body = document.getElementById('chapter_body');
      if (body.value.trim()) return showMessage('Şablonu eklemeden önce metin alanını temizle; yazdığın metni korudum.', true);
      body.value = t.starter;
      body.focus();
    };
  };
  document.getElementById('kind').addEventListener('change', e => applyWritingTemplate(e.target.value));
  document.getElementById('coverMakerBtn')?.addEventListener('click', () => openCoverMaker());

  const mangaPages = [];
  const renderMangaPages = () => {
    const list = document.getElementById('mangaPagesList');
    list.innerHTML = mangaPages.map((p, i) => `
      <div class="manga-page-item">
        <img src="${p.url}" alt="Sayfa ${i + 1}">
        <span class="small">Sayfa ${i + 1}</span>
        <button class="para-badge manga-page-del" type="button" data-i="${i}" title="Kaldır" style="position:static;opacity:1">✕</button>
      </div>`).join('');
    list.querySelectorAll('.manga-page-del').forEach(b => b.addEventListener('click', () => {
      URL.revokeObjectURL(mangaPages[b.dataset.i].url);
      mangaPages.splice(Number(b.dataset.i), 1);
      renderMangaPages();
    }));
  };
  document.getElementById('mangaPageFiles').addEventListener('change', e => {
    for (const file of e.target.files || []) {
      if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) {
        showMessage(`"${file.name}" atlandı — JPG/PNG/WebP ve 15 MB altı olmalı.`, true); continue;
      }
      mangaPages.push({ blob: file, url: URL.createObjectURL(file) });
    }
    e.target.value = '';
    renderMangaPages();
  });
  document.getElementById('panelComposerBtn').addEventListener('click', () => {
    openPanelComposer(blob => {
      mangaPages.push({ blob, url: URL.createObjectURL(blob) });
      renderMangaPages();
    });
  });
  document.getElementById('bookCover').addEventListener('change', event => {
    const file = event.currentTarget.files?.[0];
    const preview = document.getElementById('bookCoverPreview');
    if (!file) { preview.classList.remove('visible'); preview.removeAttribute('src'); return; }
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      event.currentTarget.value = '';
      return showMessage('Kapak JPG, PNG veya WebP olmalı ve 5 MB sınırını aşmamalı.', true);
    }
    preview.src = URL.createObjectURL(file);
    preview.classList.add('visible');
  });
  bindRichTextTools(document.getElementById('chapterTools'), document.getElementById('chapter_body'));
  applyWritingTemplate(document.getElementById('kind').value);
  document.getElementById('tags').addEventListener('input', e => {
    const tags = parseHashtags(e.target.value);
    document.getElementById('hashtagPreview').innerHTML = tags.map(tag => `<span class="hashtag">#${esc(tag)}</span>`).join('');
  });

  document.getElementById('writeForm').addEventListener('input', () => markDraftDirty('writing'));
  document.getElementById('writeForm').addEventListener('submit', async e => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const title = String(form.get('title') || '').trim();
    const description = String(form.get('description') || '').trim();
    const tags = parseHashtags(form.get('tags'));
    const chapterTitle = String(form.get('chapter_title') || '').trim();
    const chapterBody = String(form.get('chapter_body') || '').trim();
    const kind = String(form.get('kind') || 'blog');
    let coverFile = document.getElementById('bookCover').files?.[0] || null;
    const submit = e.currentTarget.querySelector('button[type="submit"]');
    if (!title) { showMessage('Lütfen eserine bir ad ver.', true); return; }
    submit.disabled = true;
    submit.textContent = 'Yayımlanıyor…';
    try {
      let coverPath = null;
      if (isChapteredKind(kind) && coverFile) {
        const extension = ({ 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp' })[coverFile.type];
        if (!extension || coverFile.size > 5 * 1024 * 1024) { showMessage('Kapak JPG, PNG veya WebP olmalı ve 5 MB sınırını aşmamalı.', true); return; }
        coverFile = await compressImage(coverFile, 1280);
        coverPath = `${currentUser.id}/book-covers/${crypto.randomUUID()}.${coverFile.type === 'image/webp' ? 'webp' : extension}`;
        const upload = await sb.storage.from('profile-images').upload(coverPath, coverFile, { contentType: coverFile.type, upsert: false });
        if (upload.error) { showMessage('Kitap kapağı yüklenemedi: ' + upload.error.message, true); return; }
      }
      const postValues = {
        author_id: currentUser.id,
        title,
        category: tags[0] || 'Diğer',
        tags,
        kind,
        description,
        pen_name: String(form.get('pen_name') || '').trim().slice(0, 60) || null,
        critique_wanted: form.get('critique_wanted') === 'on',
        allow_download: form.get('allow_download') === 'on',
        theme_id: new URLSearchParams(location.hash.split('?')[1] || '').get('theme') || null
      };
      if (coverPath) postValues.cover_path = coverPath;
      if (kind === 'manga' && !mangaPages.length && !chapterBody) {
        showMessage('Manga için en az bir sayfa yükle, panel oluşturucuyla çiz ya da senaryo metni yaz.', true); return;
      }
      const { data: post, error } = await sb.from('posts').insert(postValues).select().single();
      if (error) {
        if (coverPath) await sb.storage.from('profile-images').remove([coverPath]);
        showMessage('Eser oluşturulamadı: ' + error.message, true); return;
      }
      if (kind === 'manga') {
        for (let i = 0; i < mangaPages.length; i++) {
          const page = await compressImage(mangaPages[i].blob, 1600);
          const ext = page.type === 'image/webp' ? 'webp' : 'png';
          const path = `${currentUser.id}/manga-pages/${post.id}/${i + 1}.${ext}`;
          const up = await sb.storage.from('post-media').upload(path, page, { contentType: page.type, upsert: false });
          if (up.error) { showMessage(`Sayfa ${i + 1} yüklenemedi: ` + up.error.message, true); return; }
          const mediaUrl = sb.storage.from('post-media').getPublicUrl(path).data.publicUrl;
          const { error: cErr } = await sb.from('chapters').insert({
            post_id: post.id, position: i + 1, title: `Sayfa ${i + 1}`, body: '', media_url: mediaUrl
          });
          if (cErr) { showMessage(`Sayfa ${i + 1} kaydedilemedi: ` + cErr.message, true); return; }
        }
        if (chapterBody) {
          await sb.from('chapters').insert({
            post_id: post.id, position: mangaPages.length + 1,
            title: chapterTitle || 'Senaryo', body: chapterBody
          });
        }
      } else if (chapterBody) {
        const { error: chapterError } = await sb.from('chapters').insert({
          post_id: post.id, position: 1,
          title: chapterTitle || (isChapteredKind(String(form.get('kind'))) ? '1. Bölüm' : String(form.get('kind')) === 'short' ? 'Metin' : 'Yazı'),
          body: chapterBody
        });
        if (chapterError) {
          showMessage('Eser oluşturuldu ancak ilk bölüm kaydedilemedi: ' + chapterError.message, true);
          return;
        }
      }
      clearDraft();
      location.hash = '#/read/' + encodeURIComponent(post.id);
    } catch (err) {
      showMessage(err.message || 'Bir hata oluştu.', true);
    } finally {
      submit.disabled = false;
      submit.textContent = 'Eseri yayımla';
    }
  });
}

async function adminFlagContent(targetType, targetId, button) {
  if (!isCurrentUserAdmin) return;
  button.disabled = true;
  const { data, error } = await sb.rpc('admin_flag_content', { target_type: targetType, target_id: String(targetId) });
  if (error) { button.disabled = false; return alert('Kuyruğa alınamadı: ' + error.message); }
  button.textContent = data ? 'Kuyrukta ⚑' : 'Zaten kuyrukta';
}

function reportFormHTML(type, targetId, className = 'report-form', formId = '') {
  return `<form ${formId ? `id="${formId}"` : ''} class="${className} report-form" data-target-type="${esc(type)}" data-target-id="${esc(targetId)}" hidden>
    <label class="small">Bildirim nedeni</label>
    <select required><option value="">Bir neden seç</option><option value="spam">Spam</option><option value="harassment">Taciz veya zorbalık</option><option value="copyright">Telif hakkı</option><option value="unsafe">Güvenli olmayan içerik</option><option value="other">Diğer</option></select>
    <textarea maxlength="1000" placeholder="İstersen kısaca açıkla (isteğe bağlı)"></textarea>
    <button class="btn small" type="submit">Bildirimi gönder</button><span class="small report-message" aria-live="polite"></span>
  </form>`;
}

function bindReportForms(scope) {
  scope.querySelectorAll('.report-form').forEach(form => {
    if (form.dataset.bound) return;
    form.dataset.bound = 'true';
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!currentUser) { location.hash = '#/auth?login'; return; }
      const button = form.querySelector('button[type="submit"]');
      const message = form.querySelector('.report-message');
      button.disabled = true;
      message.textContent = 'Gönderiliyor…';
      const { error } = await sb.rpc('submit_content_report', {
        target_type: form.dataset.targetType,
        target_id: form.dataset.targetId,
        report_reason: form.querySelector('select').value,
        report_details: form.querySelector('textarea').value.trim()
      });
      button.disabled = false;
      if (error) { message.textContent = `Gönderilemedi: ${error.message}`; message.classList.add('error'); return; }
      message.textContent = 'Bildirimin alındı. Teşekkürler.';
      message.classList.remove('error');
      form.querySelector('select').disabled = true;
      form.querySelector('textarea').disabled = true;
      button.disabled = true;
    });
  });
}

function initReadingProgress(post, chapters) {
  const bar = document.getElementById('continueReadingBar');
  const saveProgress = idx => {
    sb.from('reading_progress')
      .upsert({ user_id: currentUser.id, post_id: post.id, chapter_index: idx }, { onConflict: 'user_id,post_id' })
      .then(() => {});
  };
  let lastSaved = -1;
  let saveTimer = null;
  readScrollHandler = () => {
    const mid = window.scrollY + window.innerHeight * 0.35;
    let current = 0;
    document.querySelectorAll('[data-chapter-index]').forEach(el => {
      if (el.offsetTop <= mid) current = Number(el.dataset.chapterIndex);
    });
    if (current !== lastSaved) {
      lastSaved = current;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveProgress(current), 1500);
    }
  };
  window.addEventListener('scroll', readScrollHandler, { passive: true });

  sb.from('reading_progress').select('chapter_index').eq('user_id', currentUser.id).eq('post_id', post.id).maybeSingle()
    .then(({ data }) => {
      if (!data || !bar || data.chapter_index <= 0 || data.chapter_index >= chapters.length) return;
      document.getElementById('continueReadingText').textContent =
        `“${post.title || 'Bu eser'}” içinde ${chapters[data.chapter_index]?.title || (data.chapter_index + 1) + '. bölüm'} civarında kalmıştın.`;
      bar.hidden = false;
      document.getElementById('continueReadingBtn').addEventListener('click', () => {
        document.getElementById(`chapter-${data.chapter_index}`)?.scrollIntoView({ behavior: 'smooth' });
        bar.hidden = true;
      });
    });
}

async function renderRead(id, query = '') {
  app.innerHTML = `<div class="loading"><div class="spinner-container"><div class="spinner-rings"></div><span>Eser açılıyor…</span></div></div>`;

  const { data: post, error } = await sb.from('posts').select('*').eq('id', id).maybeSingle();
  if (error || !post) {
    app.innerHTML = '<div class="empty">Bu eser bulunamadı veya görüntülenemiyor.</div>';
    return;
  }
  Object.assign(post, (await attachBookCovers([post]))[0] || {});
  await signPostMedia([post]);

  const viewKey = `viewed:${id}`;
  if (!sessionStorage.getItem(viewKey)) {
    sessionStorage.setItem(viewKey, '1');
    post.view_count = Number(post.view_count || 0) + 1;
    sb.rpc('increment_post_view', { target_post: id }).then(() => {});
  }
  if (currentUser) {
    sb.from('view_history').upsert({ user_id: currentUser.id, post_id: id, viewed_at: new Date().toISOString() }).then(() => {});
  }

  const { data: chapters, error: chapterError } = await sb.from('chapters').select('*').eq('post_id', id).order('position', { ascending: true });
  await signPostMedia(chapters || []);
  let characters = [];
  if (isChapteredKind(post.kind)) {
    const { data: chars } = await sb.from('post_characters').select('*').eq('post_id', id).order('position', { ascending: true });
    characters = chars || [];
  }
  const { data: profile } = await sb.from('profiles').select('id,username,display_name').eq('id', post.author_id).maybeSingle();
  const { data: versions } = await sb.from('post_versions').select('*').eq('post_id', id).order('version_no', { ascending: true });
  await signPostMedia(versions || []);
  const versionList = versions || [];
  const currentVersionNo = versionList.length + 1;

  const likesResult = await sb.from('likes').select('user_id').eq('post_id', id);
  const likes = likesResult.data || [];
  let likeCount = likes.length;
  let userLiked = !!currentUser && likes.some(l => l.user_id === currentUser.id);

  const commentsResult = await sb.from('comments').select('*').eq('post_id', id).order('created_at', { ascending: true });
  const comments = commentsResult.data || [];
  const commentIds = comments.map(c => c.id);
  const commentLikesResult = commentIds.length
    ? await sb.from('comment_like_counts').select('comment_id,like_count').in('comment_id', commentIds)
    : { data: [], error: null };
  const userCommentLikesResult = currentUser && commentIds.length
    ? await sb.from('comment_likes').select('comment_id').eq('user_id', currentUser.id).in('comment_id', commentIds)
    : { data: [], error: null };
  const commentLikeCounts = {};
  (commentLikesResult.data || []).forEach(row => { commentLikeCounts[row.comment_id] = Number(row.like_count) || 0; });
  const userLikedCommentIds = new Set((userCommentLikesResult.data || []).map(like => like.comment_id));
  const commentAuthorIds = [...new Set(comments.map(c => c.author_id).filter(Boolean))];
  let commentProfiles = [];
  if (commentAuthorIds.length) {
    const pr = await sb.from('profiles').select('id,username,display_name').in('id', commentAuthorIds);
    commentProfiles = pr.data || [];
  }
  const commentProfileMap = Object.fromEntries(commentProfiles.map(p => [p.id, p]));

  const isOwner = !!currentUser && currentUser.id === post.author_id;
  const canReportPost = !!currentUser && !isOwner;

  const commentsByParent = new Map();
  const commentsByChapter = new Map();
  const paragraphCounts = {};
  const commentsByParagraph = new Map();
  comments.forEach(comment => {
    const key = comment.parent_comment_id || 'root';
    if (!commentsByParent.has(key)) commentsByParent.set(key, []);
    commentsByParent.get(key).push(comment);
    if (comment.chapter_id && !comment.parent_comment_id) {
      if (comment.paragraph_index === null || comment.paragraph_index === undefined) {
        if (!commentsByChapter.has(comment.chapter_id)) commentsByChapter.set(comment.chapter_id, []);
        commentsByChapter.get(comment.chapter_id).push(comment);
      } else {
        const pKey = `${comment.chapter_id}:${comment.paragraph_index}`;
        if (!commentsByParagraph.has(pKey)) commentsByParagraph.set(pKey, []);
        commentsByParagraph.get(pKey).push(comment);
        paragraphCounts[comment.chapter_id] = paragraphCounts[comment.chapter_id] || {};
        paragraphCounts[comment.chapter_id][comment.paragraph_index] = (paragraphCounts[comment.chapter_id][comment.paragraph_index] || 0) + 1;
      }
    }
  });
  const renderComment = (c, depth = 0) => {
    const cp = commentProfileMap[c.author_id];
    const canDelete = currentUser && (currentUser.id === c.author_id || isOwner);
    const canEdit = currentUser?.id === c.author_id;
    const canReport = currentUser && currentUser.id !== c.author_id;
    const commentLiked = userLikedCommentIds.has(c.id);
    const replies = commentsByParent.get(c.id) || [];
    return `
      <div class="comment" data-comment-id="${esc(c.id)}">
        <div class="comment-head">
          <span class="comment-author">${esc(displayName(cp, 'Anonim'))}</span>
          <span class="comment-date">${esc(formatDate(c.created_at))}</span>
        </div>
        <div class="comment-body">${c.media_second !== null && c.media_second !== undefined ? `<button class="comment-ts" type="button" data-sec="${c.media_second}" title="Medyada bu ana git">⏱️ ${Math.floor(c.media_second / 60)}:${String(c.media_second % 60).padStart(2, '0')}</button> ` : ''}${esc(c.body)}</div>
        <div class="comment-tools">
          <button class="comment-like ${commentLiked ? 'liked' : ''}" data-comment-id="${esc(c.id)}" type="button" aria-pressed="${commentLiked}" aria-label="Yorumu beğen">
            <span class="heart">${commentLiked ? '❤️' : '🤍'}</span><span class="comment-like-count">${commentLikeCounts[c.id] || 0}</span>
          </button>
          ${currentUser ? `<button class="comment-reply-toggle" data-comment-id="${esc(c.id)}" type="button">Yanıtla</button>` : ''}
          ${canEdit ? `<button class="comment-edit" data-comment-id="${esc(c.id)}" type="button">Düzenle</button>` : ''}
          ${canDelete ? `<button class="comment-del" data-comment-id="${esc(c.id)}" type="button">Sil</button>` : ''}
          ${canReport ? '<button class="comment-report-toggle" type="button">Bildir</button>' : ''}
          ${isCurrentUserAdmin ? `<button class="comment-admin-flag" data-comment-id="${esc(c.id)}" type="button" title="İnceleme kuyruğuna al">⚑ İncelemeye al</button>` : ''}
        </div>
        ${canReport ? reportFormHTML('comment', c.id, 'comment-report-form') : ''}
        ${canEdit ? `
          <form class="comment-edit-form" data-comment-id="${esc(c.id)}" hidden>
            <textarea required maxlength="1000" aria-label="Yorumu düzenle">${esc(c.body)}</textarea>
            <div class="comment-edit-actions">
              <button class="btn small comment-edit-cancel" type="button">Vazgeç</button>
              <button class="btn primary small" type="submit">Kaydet</button>
            </div>
          </form>` : ''}
        ${currentUser ? `<form class="comment-reply-form" data-parent-comment-id="${esc(c.id)}" hidden>
          <textarea required maxlength="1000" aria-label="Yanıtını yaz" placeholder="Yanıtını yaz…"></textarea>
          <button class="btn primary small" type="submit">Yanıtla</button>
        </form>` : ''}
        ${replies.length ? `<div class="comment-replies">${replies.map(reply => renderComment(reply, depth + 1)).join('')}</div>` : ''}
      </div>`;
  };
  const appendComment = comment => {
    comments.push(comment);
    const parentKey = comment.parent_comment_id || 'root';
    if (!commentsByParent.has(parentKey)) commentsByParent.set(parentKey, []);
    commentsByParent.get(parentKey).push(comment);
    const list = document.getElementById('commentsList');
    if (!comment.parent_comment_id) {
      if (!commentsByParent.get('root').slice(0, -1).length) list.innerHTML = '';
      list.insertAdjacentHTML('beforeend', renderComment(comment));
    } else {
      const parent = list.querySelector(`.comment[data-comment-id="${comment.parent_comment_id}"]`);
      if (!parent) return;
      let replies = parent.querySelector(':scope > .comment-replies');
      if (!replies) {
        replies = document.createElement('div');
        replies.className = 'comment-replies';
        parent.appendChild(replies);
      }
      replies.insertAdjacentHTML('beforeend', renderComment(comment));
    }
    const count = document.querySelector('.comments-section h3');
    if (count) count.textContent = `💬 Yorumlar (${comments.length})`;
    const added = list.querySelector(`.comment[data-comment-id="${comment.id}"]`);
    if (added) { bindCommentInteractions(added); bindReportForms(added); }
  };
  const bindCommentInteractions = scope => {
    scope.querySelectorAll('.comment-reply-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const form = btn.closest('.comment')?.querySelector(':scope > .comment-reply-form');
        if (!form) return;
        form.hidden = !form.hidden;
        if (!form.hidden) form.querySelector('textarea')?.focus();
      });
    });
    scope.querySelectorAll('.comment-report-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const form = btn.closest('.comment')?.querySelector(':scope > .comment-report-form');
        if (form) { form.hidden = !form.hidden; if (!form.hidden) form.querySelector('select')?.focus(); }
      });
    });
    scope.querySelectorAll('.comment-reply-form').forEach(form => {
      form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!currentUser) { location.hash = '#/auth?login'; return; }
        const textarea = form.querySelector('textarea');
        const body = textarea.value.trim();
        if (!body) return;
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        const { data, error } = await sb.from('comments').insert({
          post_id: id, author_id: currentUser.id, parent_comment_id: form.dataset.parentCommentId, body
        }).select('*').single();
        if (error) { submit.disabled = false; return alert('Yanıt gönderilemedi: ' + error.message); }
        appendComment(data);
        textarea.value = '';
        form.hidden = true;
        submit.disabled = false;
      });
    });
    scope.querySelectorAll('.comment-like').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!currentUser) { location.hash = '#/auth'; return; }
        const commentId = btn.dataset.commentId;
        const alreadyLiked = btn.getAttribute('aria-pressed') === 'true';
        btn.disabled = true;
        const result = alreadyLiked
          ? await sb.from('comment_likes').delete().eq('comment_id', commentId).eq('user_id', currentUser.id)
          : await sb.from('comment_likes').insert({ comment_id: commentId, user_id: currentUser.id });
        if (result.error) { btn.disabled = false; alert('Yorum beğenisi kaydedilemedi: ' + result.error.message); return; }
        const nextLiked = !alreadyLiked;
        btn.setAttribute('aria-pressed', String(nextLiked));
        btn.classList.toggle('liked', nextLiked);
        btn.querySelector('.heart').textContent = nextLiked ? '❤️' : '🤍';
        const count = Math.max(0, (commentLikeCounts[commentId] || 0) + (nextLiked ? 1 : -1));
        commentLikeCounts[commentId] = count;
        btn.querySelector('.comment-like-count').textContent = count;
        if (nextLiked) userLikedCommentIds.add(commentId); else userLikedCommentIds.delete(commentId);
        btn.disabled = false;
      });
    });
    scope.querySelectorAll('.comment-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const form = btn.closest('.comment')?.querySelector('.comment-edit-form');
        if (form) { form.hidden = false; form.querySelector('textarea')?.focus(); }
      });
    });
    scope.querySelectorAll('.comment-edit-cancel').forEach(btn => {
      btn.addEventListener('click', () => { btn.closest('.comment-edit-form').hidden = true; });
    });
    scope.querySelectorAll('.comment-edit-form').forEach(form => {
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const body = form.querySelector('textarea').value.trim();
        if (!body) return;
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        const { error } = await sb.from('comments').update({ body })
          .eq('id', form.dataset.commentId).eq('author_id', currentUser.id);
        submit.disabled = false;
        if (error) { alert('Yorum düzenlenemedi: ' + error.message); return; }
        const comment = comments.find(c => String(c.id) === String(form.dataset.commentId));
        if (comment) comment.body = body;
        form.closest('.comment')?.querySelector(':scope > .comment-body')?.replaceChildren(document.createTextNode(body));
        form.hidden = true;
      });
    });
    scope.querySelectorAll('.comment-admin-flag').forEach(btn => {
      btn.addEventListener('click', () => adminFlagContent('comment', btn.dataset.commentId, btn));
    });
    scope.querySelectorAll('.comment-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Bu yorumu silmek istediğinden emin misin?')) return;
        const cid = btn.dataset.commentId;
        const { error } = await sb.from('comments').delete().eq('id', cid);
        if (error) { alert('Yorum silinemedi: ' + error.message); return; }
        renderRead(id);
      });
    });
  };

  app.innerHTML = `
    <p><a href="#/">← Eserlere dön</a></p>
    <section class="hero">
      <div class="eyebrow">${esc(quickTypeLabel(post))}</div>
      <h1>${esc(post.title || 'Başlıksız eser')}</h1>
      <div class="post-tags">${hashtagHTML(post)}</div>
      <p class="subtitle">${esc(post.description || '')}</p>
      <div class="meta">
        <span>${!post.type || post.type === 'writing' ? 'Yazar' : 'Paylaşan'}: ${post.pen_name ? `<span title="Kalem adı">✒️ ${esc(post.pen_name)}</span>` : `<a href="#/user/${encodeURIComponent(post.author_id)}">${esc(displayName(profile))}</a>`}</span>
        ${post.critique_wanted ? '<span class="critique-badge">🎯 Eleştiri bekliyor</span>' : ''}
        <span>· ${esc(formatDate(post.created_at))}</span>
        <span>· ${Number(post.view_count || 0)} görüntülenme</span>
      </div>
    </section>
    ${postCoverHTML(post)}${mediaHTML(post)}
    ${versionList.length ? `
    <div class="version-bar">
      <span class="small">📜 ${currentVersionNo}. versiyon</span>
      <div class="version-chips">
        ${versionList.map(v => `<button class="chip version-chip" type="button" data-version="${v.version_no}">v${v.version_no}</button>`).join('')}
        <button class="chip version-chip on" type="button" data-version="${currentVersionNo}">v${currentVersionNo} · güncel</button>
      </div>
      <div id="versionPanel" hidden></div>
    </div>` : ''}
    ${isOwner ? `
    <div id="versionFormWrap" hidden>
      <form id="versionForm" class="version-form">
        <div class="eyebrow">📜 Yeni versiyon yayınla</div>
        <p class="small">Mevcut hâl arşive alınır, eser güncellenir. Okuyucular eski versiyonları gezebilir.</p>
        <div class="field"><label for="versionNote">Ne değişti? (isteğe bağlı)</label><input id="versionNote" name="note" maxlength="200" placeholder="Örn. renkleri düzelttim"></div>
        ${post.media_url ? `<div class="field"><label for="versionFile">Yeni dosya (isteğe bağlı)</label><input id="versionFile" name="file" type="file" accept="${esc(MEDIA_CREATE[post.type]?.accept || 'image/jpeg,image/png,image/webp')}"><div class="small">Boş bırakırsan yalnızca başlık/açıklama güncellenir.</div></div>` : ''}
        <div class="field"><label for="versionTitle">Yeni başlık (isteğe bağlı)</label><input id="versionTitle" name="title" maxlength="120" placeholder="${esc(post.title || '')}"></div>
        <div class="field"><label for="versionDesc">Yeni açıklama (isteğe bağlı)</label><textarea id="versionDesc" name="description" maxlength="600" placeholder="${esc((post.description || '').slice(0, 200))}"></textarea></div>
        <button class="btn primary small" type="submit">Versiyonu yayınla</button>
      </form>
    </div>` : ''}
      <div class="post-actions">
      <button class="like-btn ${userLiked ? 'liked' : ''}" id="readLikeBtn">
        <span class="heart">${userLiked ? '❤️' : '🤍'}</span>
        <span class="like-count">${likeCount}</span>
      </button>
        ${currentUser ? `<a class="btn ghost small" href="#/chat?share=${encodeURIComponent(post.id)}">Sohbette paylaş</a>` : ''}
        ${currentUser ? '<button class="btn ghost small" id="collectionBtn" type="button">📚 Koleksiyona ekle</button>' : ''}
        ${isOwner ? '<button class="btn ghost small" id="newVersionBtn" type="button">📜 Yeni versiyon</button>' : ''}
        ${isOwner && (post.media_url || post.kind === 'manga') ? `<button class="btn ghost small" id="downloadToggleBtn" type="button" title="Eserin indirilip indirilemeyeceğini seç">⬇️ İndirme: ${post.allow_download ? 'açık' : 'kapalı'}</button>` : ''}
        ${isOwner && post.kind === 'manga' && (chapters || []).some(c => c.media_url) ? '<button class="btn ghost small" id="mangaCoverBtn" type="button" title="Bir sayfadan kapak üret">🖼️ Kapak üret</button>' : ''}
        ${canReportPost ? '<button class="btn ghost small" id="reportPostToggle" type="button">Eseri bildir</button>' : ''}
        ${isCurrentUserAdmin ? '<button class="btn ghost small" id="adminFlagPost" type="button">⚑ İncelemeye al</button>' : ''}
    </div>
    ${canReportPost ? reportFormHTML('post', post.id, 'report-form', 'postReportForm') : ''}
    ${chapterError ? `<div class="empty">Bölümler yüklenemedi.<br><span class="small">${esc(chapterError.message)}</span></div>` : ''}
    ${post.kind === 'manga' && (chapters || []).filter(c => c.media_url).length > 1 ? `
      <div class="manga-mode-bar" id="mangaModeBar" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        <button class="chip" data-mode="scroll" type="button">📜 Dikey akış</button>
        <button class="chip" data-mode="page" type="button">📄 Tek sayfa</button>
        <button class="chip" data-mode="rtl" type="button">📄 Sağdan sola ↩</button>
      </div>
      <div id="mangaPageNav" class="manga-page-nav" hidden style="display:flex;gap:10px;align-items:center;justify-content:center;margin-bottom:14px">
        <button class="btn ghost small" id="mpPrev" type="button">‹ Önceki</button>
        <span class="small" id="mpIndicator"></span>
        <button class="btn ghost small" id="mpNext" type="button">Sonraki ›</button>
      </div>` : ''}
    <div id="chaptersWrap">
    ${(chapters || []).map((ch, i) => {
      const chComments = commentsByChapter.get(ch.id) || [];
      return `
      <section class="chapter" id="chapter-${i}" data-chapter-index="${i}">
        <h3>${esc(ch.title || 'Bölüm')}</h3>
        ${isOwner && isChapteredKind(post.kind) ? `<div class="page-admin" style="display:flex;gap:6px;margin:4px 0 8px">
          <button class="btn ghost small ch-move" data-ch="${esc(ch.id)}" data-dir="-1" type="button" title="Yukarı taşı" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn ghost small ch-move" data-ch="${esc(ch.id)}" data-dir="1" type="button" title="Aşağı taşı" ${i === (chapters || []).length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn ghost small ch-del" data-ch="${esc(ch.id)}" data-title="${esc(ch.title || 'Sayfa')}" type="button" title="Sil">🗑</button>
        </div>` : ''}
        ${ch.media_url ? `<img class="manga-page-img" src="${esc(ch.media_url)}" alt="${esc(ch.title || 'Manga sayfası')}" loading="lazy"${post.allow_download ? '' : ' oncontextmenu="return false" draggable="false"'}>` : ''}
        ${ch.body ? `<div class="chapter-body">${renderParagraphs(ch.body, ch.id, paragraphCounts[ch.id] || {}, post.kind)}</div>` : ''}
        <div class="chapter-comments">
          <button class="chapter-comments-toggle" data-chapter="${esc(ch.id)}" type="button">💬 Bölüm yorumları (<span>${chComments.length}</span>)</button>
          <div class="chapter-comments-panel" hidden>
            <div class="chapter-comments-list">${chComments.length ? chComments.map(c => renderComment(c)).join('') : '<div class="empty small">Bu bölüme henüz yorum yok.</div>'}</div>
            ${currentUser ? `<form class="chapter-comment-form" data-chapter="${esc(ch.id)}"><textarea maxlength="1000" placeholder="Bu bölüme yorum yaz…" required></textarea><button class="btn small" type="submit">Gönder</button></form>` : ''}
          </div>
        </div>
      </section>`;
    }).join('')}
    </div>
    ${characters.length ? `<section class="card character-glossary">
      <h3 style="margin-bottom:10px">👥 Karakterler</h3>
      <div class="char-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">
        ${characters.map(c => `<div class="char-item" style="border:1px solid var(--line);border-radius:10px;padding:8px 12px"><strong>${esc(c.name)}</strong>${c.info ? `<div class="small" style="margin-top:2px">${esc(c.info)}</div>` : ''}</div>`).join('')}
      </div>
    </section>` : ''}
    ${currentUser && (chapters || []).length > 0 ? '<div class="continue-reading" id="continueReadingBar" hidden><span id="continueReadingText"></span><button class="btn primary small" id="continueReadingBtn" type="button">Kaldığın yerden devam et</button></div>' : ''}
    ${(!chapterError && !post.media_url && !post.cover_path && !(chapters || []).length) ? '<div class="empty">Bu esere henüz bölüm eklenmemiş.</div>' : ''}

    <section class="comments-section">
      <h3 style="font-family:'Fredoka',sans-serif;margin-bottom:14px">💬 Yorumlar (${comments.length})</h3>
      <div id="commentsList">
        ${commentsByParent.get('root')?.filter(c => !c.chapter_id).length ? commentsByParent.get('root').filter(c => !c.chapter_id).map(c => renderComment(c)).join('') : '<div class="empty">Henüz yorum yok. İlk yorumu sen yap!</div>'}
      </div>
      ${commentLikesResult.error || userCommentLikesResult.error ? '<p class="small message error">Yorum beğenileri için veritabanı güncellemesi gerekiyor.</p>' : ''}
      ${currentUser ? `
        <form class="comment-form" id="commentForm">
          <textarea id="commentBody" placeholder="Yorumunu yaz…" required maxlength="1000"></textarea>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="btn primary" type="submit">Yorumu gönder</button>
            ${['music','video'].includes(post.type) && post.media_url ? `<button class="btn ghost small" id="timestampBtn" type="button">⏱️ Bu anı işaretle</button><span class="small" id="timestampHint"></span>` : ''}
          </div>
        </form>
      ` : `
        <div class="empty">Yorum yapmak için <a href="#/auth?signup">giriş yap</a>.</div>
      `}
    </section>

    ${isOwner ? `
      <hr>
        ${(!post.type || post.type === 'writing') ? `<section class="card">
        <h3>${post.kind === 'manga' ? 'Yeni sayfa ekle' : 'Yeni bölüm ekle'}</h3>
        <form id="chapterForm">
          ${post.kind === 'manga' ? `
          <div class="field">
            <label>Sayfa görselleri</label>
            <input id="cpageFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple>
            <button class="btn ghost small" id="cComposerBtn" type="button">🎨 Panel oluşturucu</button>
            <div id="cPagesList" class="manga-page-list"></div>
          </div>
          <div class="field">
            <label for="cbody">Not / senaryo (isteğe bağlı)</label>
            <textarea id="cbody" name="cbody"></textarea>
          </div>` : `
          <div class="field">
            <label for="ctitle">Bölüm başlığı</label>
            <input id="ctitle" name="ctitle" required maxlength="120">
          </div>
          <div class="field">
            <label for="cbody">Metin</label>
            ${isChapteredKind(post.kind) ? '<div class="rich-tools" id="newChapterTools"><button class="btn ghost small" type="button" data-wrap="**">Kalın: **…**</button><button class="btn ghost small" type="button" data-wrap="()">İtalik: (…)</button></div>' : ''}
            <textarea id="cbody" name="cbody" ${post.kind === 'light_novel' ? '' : 'required'}></textarea>
            ${post.kind === 'light_novel' ? '<div class="small">Light novel&#39;de metin boş bırakılırsa yalnızca illüstrasyon sayfası eklenir.</div>' : ''}
          </div>
          ${post.kind === 'light_novel' ? `
          <div class="field">
            <label for="cIllustration">🎑 İllüstrasyon (isteğe bağlı)</label>
            <input id="cIllustration" name="illustration" type="file" accept="image/jpeg,image/png,image/webp">
            <div class="small">Bölüm sonrasına görsel sayfa olarak eklenir — light novel geleneği.</div>
          </div>` : ''}`}
          <button class="btn primary" type="submit">${post.kind === 'manga' ? 'Sayfaları ekle' : 'Bölümü ekle'}</button>
          <div id="message" class="message"></div>
        </form>
      </section>` : ''}
      ${isChapteredKind(post.kind) ? `<section class="card">
        <h3>👥 Karakter sözlüğü</h3>
        <div id="charList" style="display:grid;gap:6px;margin-bottom:10px">
          ${characters.length ? characters.map(c => `<div style="display:flex;gap:8px;align-items:center"><strong>${esc(c.name)}</strong><span class="small" style="flex:1">${esc(c.info || '')}</span><button class="btn ghost small char-del" data-char="${esc(c.id)}" type="button" title="Sil">🗑</button></div>`).join('') : '<div class="empty small">Henüz karakter eklenmemiş.</div>'}
        </div>
        <form id="charForm" style="display:flex;gap:8px;flex-wrap:wrap">
          <input name="cname" required maxlength="80" placeholder="Karakter adı" style="flex:1;min-width:140px">
          <input name="cinfo" maxlength="400" placeholder="Kısa bilgi (isteğe bağlı)" style="flex:2;min-width:180px">
          <button class="btn primary small" type="submit">Ekle</button>
        </form>
      </section>` : ''}
      <p><button class="btn danger" id="deleteBtn" type="button">Eseri sil</button></p>` : ''}
  `;

  document.getElementById('collectionBtn')?.addEventListener('click', () => openCollectionPicker(post.id));
  document.getElementById('adminFlagPost')?.addEventListener('click', e => adminFlagContent('post', post.id, e.currentTarget));
  document.getElementById('readLikeBtn')?.addEventListener('click', async () => {
    if (!currentUser) { location.hash = '#/auth?signup'; return; }
    const button = document.getElementById('readLikeBtn');
    button.disabled = true;
    const result = userLiked
      ? await sb.from('likes').delete().eq('post_id', id).eq('user_id', currentUser.id)
      : await sb.from('likes').insert({ post_id: id, user_id: currentUser.id });
    if (result.error) {
      button.disabled = false;
      alert('Beğeni kaydedilemedi: ' + result.error.message);
      return;
    }
    userLiked = !userLiked;
    likeCount += userLiked ? 1 : -1;
    button.classList.toggle('liked', userLiked);
    button.querySelector('.heart').textContent = userLiked ? '❤️' : '🤍';
    button.querySelector('.like-count').textContent = likeCount;
    button.disabled = false;
  });

  let pendingTimestamp = null;
  document.getElementById('timestampBtn')?.addEventListener('click', () => {
    const media = app.querySelector('video.media, audio.media') || app.querySelector('video, audio');
    if (!media || !isFinite(media.currentTime)) return;
    pendingTimestamp = Math.floor(media.currentTime);
    const hint = document.getElementById('timestampHint');
    if (hint) hint.textContent = `${Math.floor(pendingTimestamp / 60)}:${String(pendingTimestamp % 60).padStart(2, '0')} işaretlendi`;
    document.getElementById('commentBody')?.focus();
  });
  document.getElementById('commentForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const body = document.getElementById('commentBody').value.trim();
    if (!body) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    const { data, error: cErr } = await sb.from('comments').insert({
      post_id: id, author_id: currentUser.id, body,
      media_second: pendingTimestamp
    }).select('*').single();
    button.disabled = false;
    if (cErr) { alert('Yorum eklenemedi: ' + cErr.message); return; }
    form.reset();
    pendingTimestamp = null;
    const hint = document.getElementById('timestampHint');
    if (hint) hint.textContent = '';
    appendComment(data);
  });
  bindCommentInteractions(document.getElementById('commentsList'));
  document.querySelectorAll('.chapter-comments-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.parentElement.querySelector('.chapter-comments-panel');
      if (!panel) return;
      panel.hidden = !panel.hidden;
      if (!panel.hidden) bindCommentInteractions(panel);
    });
  });
  document.querySelectorAll('.chapter-comment-form').forEach(form => {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const textarea = form.querySelector('textarea');
      const body = textarea.value.trim();
      if (!body) return;
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      const { data, error: cErr } = await sb.from('comments').insert({
        post_id: id, author_id: currentUser.id, chapter_id: form.dataset.chapter, body
      }).select('*').single();
      submitBtn.disabled = false;
      if (cErr) { alert('Yorum eklenemedi: ' + cErr.message); return; }
      textarea.value = '';
      comments.push(data);
      const chapterKey = form.dataset.chapter;
      if (!commentsByChapter.has(chapterKey)) commentsByChapter.set(chapterKey, []);
      commentsByChapter.get(chapterKey).push(data);
      const parentKey = 'root';
      if (!commentsByParent.has(parentKey)) commentsByParent.set(parentKey, []);
      commentsByParent.get(parentKey).push(data);
      const list = form.parentElement.querySelector('.chapter-comments-list');
      if (list && commentsByChapter.get(chapterKey).length === 1) list.innerHTML = '';
      list?.insertAdjacentHTML('beforeend', renderComment(data));
      const added = list?.querySelector(`.comment[data-comment-id="${data.id}"]`);
      if (added) { bindCommentInteractions(added); bindReportForms(added); }
      const count = form.parentElement.parentElement.querySelector('.chapter-comments-toggle span');
      if (count) count.textContent = commentsByChapter.get(chapterKey).length;
    });
  });
  document.querySelectorAll('.para-badge').forEach(btn => {
    btn.addEventListener('click', () => {
      const paraEl = document.querySelector(`.para[data-chapter="${CSS.escape(btn.dataset.chapter)}"][data-para="${CSS.escape(btn.dataset.para)}"]`);
      if (!paraEl) return;
      const pKey = `${btn.dataset.chapter}:${btn.dataset.para}`;
      const existing = paraEl.querySelector('.para-panel');
      if (existing) { existing.remove(); return; }
      document.querySelectorAll('.para-panel').forEach(p => p.remove());
      const pComments = commentsByParagraph.get(pKey) || [];
      const panel = document.createElement('div');
      panel.className = 'para-panel';
      panel.innerHTML = `
        <div class="para-comments-list">${pComments.length ? pComments.map(c => renderComment(c)).join('') : '<div class="empty small">Bu paragrafa henüz yorum yok.</div>'}</div>
        ${currentUser ? `<form class="chapter-comment-form para-comment-form" data-chapter="${esc(btn.dataset.chapter)}" data-para="${esc(btn.dataset.para)}"><textarea maxlength="1000" placeholder="Bu paragrafa yorum yaz…" required></textarea><button class="btn small" type="submit">Gönder</button></form>` : '<div class="small" style="margin-top:8px">Yorum için <a href="#/auth?login">giriş yap</a>.</div>'}`;
      paraEl.appendChild(panel);
      paraEl.querySelectorAll('.comment').forEach(c => { bindCommentInteractions(c); });
      bindReportForms(panel);
      panel.querySelector('.para-comment-form')?.addEventListener('submit', async e => {
        e.preventDefault();
        const form = e.currentTarget;
        const textarea = form.querySelector('textarea');
        const body = textarea.value.trim();
        if (!body) return;
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        const { data, error: cErr } = await sb.from('comments').insert({
          post_id: id, author_id: currentUser.id,
          chapter_id: btn.dataset.chapter, paragraph_index: Number(btn.dataset.para), body
        }).select('*').single();
        submitBtn.disabled = false;
        if (cErr) { alert('Yorum eklenemedi: ' + cErr.message); return; }
        comments.push(data);
        if (!commentsByParagraph.has(pKey)) commentsByParagraph.set(pKey, []);
        commentsByParagraph.get(pKey).push(data);
        const list = panel.querySelector('.para-comments-list');
        if (commentsByParagraph.get(pKey).length === 1) list.innerHTML = '';
        list.insertAdjacentHTML('beforeend', renderComment(data));
        const added = list.querySelector(`.comment[data-comment-id="${data.id}"]`);
        if (added) { bindCommentInteractions(added); bindReportForms(added); }
        textarea.value = '';
        btn.textContent = `💬 ${commentsByParagraph.get(pKey).length}`;
      });
    });
  });
  app.querySelectorAll('.comment-ts').forEach(btn => {
    btn.addEventListener('click', () => {
      const media = app.querySelector('video.media, audio.media') || app.querySelector('video, audio');
      if (!media) return;
      media.currentTime = Number(btn.dataset.sec);
      media.play?.().catch(() => {});
      media.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
  bindReportForms(app);
  document.getElementById('reportPostToggle')?.addEventListener('click', () => {
    const form = document.getElementById('postReportForm');
    form.hidden = !form.hidden;
    if (!form.hidden) form.querySelector('select')?.focus();
  });
  document.getElementById('newVersionBtn')?.addEventListener('click', () => {
    const wrap = document.getElementById('versionFormWrap');
    if (wrap) { wrap.hidden = !wrap.hidden; if (!wrap.hidden) wrap.querySelector('input')?.focus(); }
  });
  document.getElementById('downloadToggleBtn')?.addEventListener('click', async () => {
    const next = !post.allow_download;
    const { error } = await sb.from('posts').update({ allow_download: next }).eq('id', post.id).eq('author_id', currentUser.id);
    if (error) return showMessage('Ayar güncellenemedi: ' + error.message, true);
    showMessage(next ? 'İndirme açıldı — imzalı link üzerinden indirilebilir.' : 'İndirme kapatıldı.');
    renderRead(post.id);
  });
  document.querySelectorAll('.version-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = document.getElementById('versionPanel');
      if (!panel) return;
      const vno = Number(btn.dataset.version);
      document.querySelectorAll('.version-chip').forEach(c => c.classList.toggle('on', c === btn));
      if (vno === currentVersionNo) { panel.hidden = true; panel.innerHTML = ''; return; }
      const v = versionList.find(x => x.version_no === vno);
      if (!v) return;
      const snapshot = { ...post, title: v.title || post.title, description: v.content ?? post.description, media_url: v.media_url || post.media_url };
      panel.innerHTML = `<div class="version-snapshot"><div class="eyebrow">📜 v${vno} · ${esc(formatDate(v.created_at))}${v.note ? ` · ${esc(v.note)}` : ''}</div>${v.title && v.title !== post.title ? `<h3>${esc(v.title)}</h3>` : ''}${v.content && v.content !== post.description ? `<p>${esc(v.content)}</p>` : ''}${v.media_url && v.media_url !== post.media_url ? mediaHTML(snapshot) : ''}</div>`;
      panel.hidden = false;
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });
  document.getElementById('versionForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const submit = form.querySelector('button[type="submit"]');
    const note = String(fd.get('note') || '').trim().slice(0, 200) || null;
    const newTitle = String(fd.get('title') || '').trim().slice(0, 120) || null;
    const newDesc = String(fd.get('description') || '').trim().slice(0, 600) || null;
    let file = document.getElementById('versionFile')?.files?.[0] || null;
    if (!newTitle && !newDesc && !file) { alert('Bir değişiklik gir — en az bir alan dolmalı.'); return; }
    submit.disabled = true;
    submit.textContent = 'Yayınlanıyor…';
    try {
      const { error: archErr } = await sb.from('post_versions').insert({
        post_id: post.id, version_no: currentVersionNo,
        title: post.title, content: post.description, media_url: post.media_url, note
      });
      if (archErr) throw new Error('Arşiv kaydedilemedi: ' + archErr.message);
      let newMediaUrl = null;
      if (file) {
        const cfg = MEDIA_CREATE[post.type];
        let mime = (file.type || 'application/octet-stream').split(';')[0].trim();
        if (post.type === 'drawing' || post.type === 'photo') {
          const compressed = await compressImage(file, 1920);
          if (compressed !== file) { file = compressed; mime = 'image/webp'; }
        }
        const ext = ({ ...IMAGE_EXT, ...VIDEO_EXT, 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/mp4': 'm4a' })[mime] || mime.split('/')[1] || 'bin';
        const path = `${currentUser.id}/${cfg?.folder || 'files'}/${crypto.randomUUID()}.${ext}`;
        const up = await sb.storage.from('post-media').upload(path, file, { contentType: mime, upsert: false });
        if (up.error) throw new Error('Dosya yüklenemedi: ' + up.error.message);
        newMediaUrl = sb.storage.from('post-media').getPublicUrl(path).data.publicUrl;
      }
      const update = {};
      if (newTitle) update.title = newTitle;
      if (newDesc) update.description = newDesc;
      if (newMediaUrl) update.media_url = newMediaUrl;
      if (!Object.keys(update).length) update.description = post.description || '';
      const { error: upErr } = await sb.from('posts').update(update).eq('id', post.id).eq('author_id', currentUser.id);
      if (upErr) throw new Error('Eser güncellenemedi: ' + upErr.message);
      renderRead(id);
    } catch (err) {
      alert(err.message || 'Versiyon yayınlanamadı.');
      submit.disabled = false;
      submit.textContent = 'Versiyonu yayınla';
    }
  });
  if (new URLSearchParams(query).get('comments') === '1') requestAnimationFrame(() => document.querySelector('.comments-section')?.scrollIntoView({ behavior: 'smooth' }));

  if (currentUser && (chapters || []).length) initReadingProgress(post, chapters);

  if (!isOwner) return;

  if (isChapteredKind(post.kind)) bindRichTextTools(document.getElementById('newChapterTools'), document.getElementById('cbody'));

  const pendingPages = [];
  const renderCPages = () => {
    const list = document.getElementById('cPagesList');
    if (!list) return;
    list.innerHTML = pendingPages.map((p, i) => `
      <div class="manga-page-item"><img src="${p.url}" alt="Sayfa"><button class="para-badge manga-page-del" type="button" data-i="${i}" style="position:static;opacity:1">✕</button></div>`).join('');
    list.querySelectorAll('.manga-page-del').forEach(b => b.addEventListener('click', () => {
      URL.revokeObjectURL(pendingPages[b.dataset.i].url);
      pendingPages.splice(Number(b.dataset.i), 1); renderCPages();
    }));
  };
  document.getElementById('cpageFiles')?.addEventListener('change', e => {
    for (const f of e.target.files || []) {
      if (!['image/jpeg','image/png','image/webp'].includes(f.type) || f.size > 15 * 1024 * 1024) continue;
      pendingPages.push({ blob: f, url: URL.createObjectURL(f) });
    }
    e.target.value = ''; renderCPages();
  });
  document.getElementById('cComposerBtn')?.addEventListener('click', () => {
    openPanelComposer(blob => { pendingPages.push({ blob, url: URL.createObjectURL(blob) }); renderCPages(); });
  });
  document.getElementById('chapterForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const form = new FormData(e.target);
    const last = (chapters || []).reduce((m, c) => Math.max(m, c.position || 0), 0);
    if (post.kind === 'manga') {
      const note = String(form.get('cbody') || '').trim();
      if (!pendingPages.length && !note) return showMessage('En az bir sayfa ekle veya not yaz.', true);
      const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
      for (let i = 0; i < pendingPages.length; i++) {
        const page = await compressImage(pendingPages[i].blob, 1600);
        const ext = page.type === 'image/webp' ? 'webp' : 'png';
        const path = `${currentUser.id}/manga-pages/${post.id}/${Date.now()}-${i}.${ext}`;
        const up = await sb.storage.from('post-media').upload(path, page, { contentType: page.type, upsert: false });
        if (up.error) { btn.disabled = false; return showMessage(`Sayfa yüklenemedi: ` + up.error.message, true); }
        const mediaUrl = sb.storage.from('post-media').getPublicUrl(path).data.publicUrl;
        const { error: cErr } = await sb.from('chapters').insert({
          post_id: post.id, position: last + 1 + i, title: `Sayfa ${last + 1 + i}`, body: '', media_url: mediaUrl
        });
        if (cErr) { btn.disabled = false; return showMessage('Sayfa kaydedilemedi: ' + cErr.message, true); }
      }
      if (note) await sb.from('chapters').insert({ post_id: post.id, position: last + 1 + pendingPages.length, title: 'Senaryo', body: note });
      renderRead(id);
      return;
    }
    const body = String(form.get('cbody') || '').trim();
    const illFile = post.kind === 'light_novel' ? (document.getElementById('cIllustration')?.files?.[0] || null) : null;
    if (post.kind === 'light_novel' && !body && !illFile) return showMessage('Metin yaz veya illüstrasyon ekle.', true);
    let nextPos = last + 1;
    if (body) {
      const { error: insertError } = await sb.from('chapters').insert({
        post_id: post.id, position: nextPos++,
        title: String(form.get('ctitle') || '').trim(),
        body
      });
      if (insertError) return showMessage('Bölüm eklenemedi: ' + insertError.message, true);
    }
    if (illFile) {
      const img = await compressImage(illFile, 1600);
      const ext = img.type === 'image/webp' ? 'webp' : 'png';
      const path = `${currentUser.id}/ln-illustrations/${post.id}/${Date.now()}.${ext}`;
      const up = await sb.storage.from('post-media').upload(path, img, { contentType: img.type, upsert: false });
      if (up.error) return showMessage('İllüstrasyon yüklenemedi: ' + up.error.message, true);
      const mediaUrl = sb.storage.from('post-media').getPublicUrl(path).data.publicUrl;
      const { error: illErr } = await sb.from('chapters').insert({
        post_id: post.id, position: nextPos,
        title: String(form.get('ctitle') || '').trim() || 'İllüstrasyon',
        body: '', media_url: mediaUrl
      });
      if (illErr) return showMessage('İllüstrasyon kaydedilemedi: ' + illErr.message, true);
    }
    renderRead(id);
  });

  // Manga sayfa yönetimi: sırala / sil
  app.querySelectorAll('.ch-move').forEach(btn => btn.addEventListener('click', async () => {
    const ch = chapters.find(c => c.id === btn.dataset.ch);
    if (!ch) return;
    const sorted = [...chapters].sort((a, b) => (a.position || 0) - (b.position || 0));
    const idx = sorted.indexOf(ch);
    const swap = sorted[idx + Number(btn.dataset.dir)];
    if (!swap) return;
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      sb.from('chapters').update({ position: swap.position }).eq('id', ch.id),
      sb.from('chapters').update({ position: ch.position }).eq('id', swap.id)
    ]);
    if (e1 || e2) return showMessage('Sıralama güncellenemedi.', true);
    renderRead(id);
  }));
  app.querySelectorAll('.ch-del').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm(`"${btn.dataset.title}" silinsin mi?`)) return;
    const ch = chapters.find(c => c.id === btn.dataset.ch);
    const { error } = await sb.from('chapters').delete().eq('id', btn.dataset.ch);
    if (error) return showMessage('Silinemedi: ' + error.message, true);
    const m = ch?.media_url?.match(/\/post-media\/([^?]+)/);
    if (m) await sb.storage.from('post-media').remove([decodeURIComponent(m[1])]);
    renderRead(id);
  }));

  // Manga okuma modu: dikey akış / tek sayfa / sağdan sola
  const modeBar = document.getElementById('mangaModeBar');
  if (modeBar) {
    const wrap = document.getElementById('chaptersWrap');
    const nav = document.getElementById('mangaPageNav');
    const ind = document.getElementById('mpIndicator');
    const sections = [...wrap.querySelectorAll('.chapter')];
    let cur = 0;
    let mode = localStorage.getItem('halka_manga_mode') || 'scroll';
    const apply = () => {
      modeBar.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.mode === mode));
      const paged = mode !== 'scroll';
      nav.hidden = !paged;
      nav.style.direction = mode === 'rtl' ? 'rtl' : 'ltr';
      sections.forEach((s, i) => { s.hidden = paged && i !== cur; });
      if (paged) ind.textContent = `${cur + 1} / ${sections.length}`;
    };
    const go = d => {
      cur = Math.min(sections.length - 1, Math.max(0, cur + d));
      apply();
      wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    modeBar.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
      mode = c.dataset.mode;
      localStorage.setItem('halka_manga_mode', mode);
      apply();
    }));
    document.getElementById('mpPrev').addEventListener('click', () => go(-1));
    document.getElementById('mpNext').addEventListener('click', () => go(1));
    const keyNav = e => {
      if (mode === 'scroll' || !document.getElementById('chaptersWrap')) return document.removeEventListener('keydown', keyNav);
      const fwd = mode === 'rtl' ? e.key === 'ArrowLeft' : e.key === 'ArrowRight';
      const back = mode === 'rtl' ? e.key === 'ArrowRight' : e.key === 'ArrowLeft';
      if (fwd) go(1); else if (back) go(-1);
    };
    document.addEventListener('keydown', keyNav);
    apply();
  }

  // Manga kapak üretici: sayfa seç → başlık bandıyla kompoze et → cover_path'e yaz
  document.getElementById('mangaCoverBtn')?.addEventListener('click', () => {
    const pages = chapters.filter(c => c.media_url);
    const modal = document.createElement('div');
    modal.className = 'badge-modal-backdrop';
    modal.innerHTML = `<div class="card badge-modal" role="dialog" aria-label="Kapak üret" style="max-width:520px;text-align:left">
      <button class="badge-modal-close" type="button" aria-label="Kapat">✕</button>
      <h3 style="text-align:center;margin:0 0 10px">🖼️ Kapak üret</h3>
      <p class="small">Kapağa dönüşecek sayfayı seç — başlık alt banda işlenir.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;max-height:50vh;overflow-y:auto">
        ${pages.map((p, i) => `<img src="${esc(p.media_url)}" data-i="${i}" alt="${esc(p.title || 'Sayfa')}" style="width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:8px;cursor:pointer;border:2px solid transparent" class="cover-pick">`).join('')}
      </div>
      <div id="coverMsg" class="message" aria-live="polite"></div>
    </div>`;
    document.body.appendChild(modal);
    const closeM = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) closeM(); });
    modal.querySelector('.badge-modal-close').addEventListener('click', closeM);
    modal.querySelectorAll('.cover-pick').forEach(img => img.addEventListener('click', async () => {
      const msg = modal.querySelector('#coverMsg');
      msg.textContent = 'Kapak üretiliyor…'; msg.className = 'message';
      try {
        const src = await createImageBitmap(await (await fetch(pages[Number(img.dataset.i)].media_url)).blob());
        const cv = document.createElement('canvas'); cv.width = 800; cv.height = 1200;
        const c = cv.getContext('2d');
        const s = Math.max(800 / src.width, 1200 / src.height);
        c.drawImage(src, (800 - src.width * s) / 2, (1200 - src.height * s) / 2, src.width * s, src.height * s);
        const g = c.createLinearGradient(0, 780, 0, 1200);
        g.addColorStop(0, '#0000'); g.addColorStop(1, '#000d');
        c.fillStyle = g; c.fillRect(0, 780, 800, 420);
        c.fillStyle = '#f4e8c8'; c.textAlign = 'center';
        c.font = "700 64px 'Fredoka','Segoe UI',sans-serif";
        const words = (post.title || 'Manga').split(' ');
        const lines = []; let line = '';
        words.forEach(w => { const t = line ? line + ' ' + w : w; if (c.measureText(t).width > 700 && line) { lines.push(line); line = w; } else line = t; });
        if (line) lines.push(line);
        lines.slice(0, 3).forEach((l, i) => c.fillText(l, 400, 1200 - 90 - (lines.slice(0, 3).length - 1 - i) * 78));
        const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
        const path = `${currentUser.id}/book-covers/${post.id}-${Date.now()}.png`;
        const up = await sb.storage.from('profile-images').upload(path, blob, { contentType: 'image/png', upsert: false });
        if (up.error) throw up.error;
        const { error } = await sb.from('posts').update({ cover_path: path }).eq('id', post.id).eq('author_id', currentUser.id);
        if (error) throw error;
        msg.textContent = 'Kapak kaydedildi!';
        setTimeout(() => { closeM(); renderRead(id); }, 600);
      } catch (err) {
        msg.textContent = 'Kapak üretilemedi: ' + (err.message || 'hata'); msg.className = 'message error';
      }
    }));
  });

  // Karakter sözlüğü
  document.getElementById('charForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const form = new FormData(e.target);
    const { error } = await sb.from('post_characters').insert({
      post_id: post.id,
      name: String(form.get('cname') || '').trim(),
      info: String(form.get('cinfo') || '').trim() || null,
      position: characters.length
    });
    if (error) return showMessage('Karakter eklenemedi: ' + error.message, true);
    renderRead(id);
  });
  app.querySelectorAll('.char-del').forEach(btn => btn.addEventListener('click', async () => {
    const { error } = await sb.from('post_characters').delete().eq('id', btn.dataset.char);
    if (error) return showMessage('Silinemedi: ' + error.message, true);
    renderRead(id);
  }));

  document.getElementById('deleteBtn')?.addEventListener('click', async () => {
    if (!confirm('Bu eser ve tüm bölümleri silinsin mi?')) return;
    await sb.from('chapters').delete().eq('post_id', post.id);
    const { error: deleteError } = await sb.from('posts').delete().eq('id', post.id);
    if (deleteError) return alert('Eser silinemedi: ' + deleteError.message);
    if (post.cover_path) await sb.storage.from('profile-images').remove([post.cover_path]);
    location.hash = '#/';
  });
}

async function renderProfile(id) {
  const userId = id === 'me' ? currentUser?.id : id;
  if (!userId) { location.hash = '#/auth'; return; }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    app.innerHTML = '<div class="empty">Bu profil bulunamadı.</div>';
    return;
  }

  app.innerHTML = `<div class="loading"><div class="spinner-container"><div class="spinner-rings"></div><span>Profil açılıyor…</span></div></div>`;

  const { data: profile } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (!profile) { app.innerHTML = '<div class="empty">Bu profil bulunamadı veya gizlilik ayarları nedeniyle görüntülenemiyor.</div>'; return; }

  const { data: posts, error } = await sb.from('posts').select('*').eq('author_id', userId).order('created_at', { ascending: false });
  const profilePosts = await attachBookCovers(posts || []);
  await signPostMedia(profilePosts);
  const { data: streakData } = await sb.rpc('production_streak', { target: userId });
  const streak = Number(streakData?.streak || 0);

  const name = displayName(profile);
  const isOwnProfile = currentUser?.id === userId;
  let friendship = null;
  let isBlocked = false;
  let hasBlockedYou = false;
  if (currentUser && !isOwnProfile) {
    const [friendResult, blockResult] = await Promise.all([
      sb.from('friend_requests').select('*').or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${userId}),and(sender_id.eq.${userId},receiver_id.eq.${currentUser.id})`).maybeSingle(),
      sb.from('blocks').select('*').or(`and(blocker_id.eq.${currentUser.id},blocked_id.eq.${userId}),and(blocker_id.eq.${userId},blocked_id.eq.${currentUser.id})`).maybeSingle()
    ]);
    friendship = friendResult.data;
    isBlocked = blockResult.data?.blocker_id === currentUser.id;
    hasBlockedYou = blockResult.data?.blocked_id === currentUser.id;
  }
  let savedPosts = [];
  let savedPostsError = null;
  let savedProfileMap = {};
  let historyPosts = [];
  let historyProfileMap = {};
  if (isOwnProfile) {
    const histResult = await sb.from('view_history').select('post_id,viewed_at').eq('user_id', userId).order('viewed_at', { ascending: false }).limit(12);
    const histIds = (histResult.data || []).map(h => h.post_id);
    if (histIds.length) {
      const { data: histPosts } = await sb.from('posts').select('*').in('id', histIds);
      const histById = new Map((histPosts || []).map(p => [p.id, p]));
      historyPosts = histIds.map(id => histById.get(id)).filter(Boolean);
      historyPosts = await attachBookCovers(historyPosts);
      await signPostMedia(historyPosts);
      const histAuthorIds = [...new Set(historyPosts.map(p => p.author_id).filter(Boolean))];
      const { data: histProfiles } = histAuthorIds.length
        ? await sb.from('profiles').select('id,username,display_name').in('id', histAuthorIds)
        : { data: [] };
      historyProfileMap = Object.fromEntries((histProfiles || []).map(p => [p.id, p]));
    }
    const savedResult = await sb.from('saved_posts').select('post_id').eq('user_id', userId).order('created_at', { ascending: false });
    savedPostsError = savedResult.error;
    const savedIds = (savedResult.data || []).map(row => row.post_id);
    if (savedIds.length) {
      const savedContentResult = await sb.from('posts').select('*').in('id', savedIds);
      savedPostsError ||= savedContentResult.error;
      const savedById = new Map((savedContentResult.data || []).map(post => [post.id, post]));
      savedPosts = savedIds.map(postId => savedById.get(postId)).filter(Boolean);
      savedPosts = await attachBookCovers(savedPosts);
      await signPostMedia(savedPosts);
      const savedAuthorIds = [...new Set(savedPosts.map(post => post.author_id).filter(Boolean))];
      const savedProfilesResult = savedAuthorIds.length
        ? await sb.from('profiles').select('id,username,display_name').in('id', savedAuthorIds)
        : { data: [] };
      savedProfileMap = Object.fromEntries((savedProfilesResult.data || []).map(row => [row.id, row]));
    }
  }
  const [avatarUrl, coverUrl] = await Promise.all([signedProfileImage(profile.avatar_path), signedProfileImage(profile.cover_path)]);
  const badgeStatsPromise = badgeStatsCache ? Promise.resolve({ data: badgeStatsCache }) : sb.rpc('badge_stats');
  const [statsResult, engagementResult, specialBadgesResult, badgeRowsResult, badgeStatsResult] = await Promise.all([
    sb.rpc('get_profile_stats', { target_profile_id: userId }),
    sb.rpc('user_engagement', { target_user: userId }),
    sb.rpc('user_special_badges', { target_user: userId }),
    sb.from('user_badges').select('badge_key,earned_at').eq('user_id', userId),
    badgeStatsPromise
  ]);
  const stats = statsResult.data || {};
  const engagement = engagementResult.data || {};
  const specialBadges = Array.isArray(specialBadgesResult.data) ? specialBadgesResult.data : [];
  if (!badgeStatsResult.error && badgeStatsResult.data) badgeStatsCache = badgeStatsResult.data;
  const badgeStats = badgeStatsResult.data || badgeStatsCache || {};
  const badgeEarnedAt = Object.fromEntries((badgeRowsResult.data || []).map(r => [r.badge_key, r.earned_at]));
  let isFollowing = false;
  if (currentUser && !isOwnProfile) {
    const { data: followRow } = await sb.from('follows').select('follower_id').eq('follower_id', currentUser.id).eq('followed_id', userId).maybeSingle();
    isFollowing = !!followRow;
  }
  app.innerHTML = `
    <main class="profile-page profile-layout-${['compact', 'showcase'].includes(profile.profile_layout) ? profile.profile_layout : 'standard'}" style="--profile-accent:${profileAccent(profile)}">
    <div class="profile-cover" ${coverUrl ? `style="background-image:url('${esc(coverUrl)}')"` : ''} role="img" aria-label="${esc(name)} kapak görseli"></div>
    <section class="profile-head">
      ${profileAvatar(profile, name, avatarUrl)}
      <div>
        <h1>${esc(name)}</h1>
        <div class="meta">@${esc(profile.username || '')}</div>
        ${presenceHTML(profile.last_active_at)}
        ${profile.featured_badge ? `<div class="featured-badge" title="Öne çıkan rozet">${esc(resolveBadge(profile.featured_badge, specialBadges).icon || '✦')} ${esc(resolveBadge(profile.featured_badge, specialBadges).name)}</div>` : ''}
      </div>
    </section>
    ${profile.bio ? `<p class="subtitle">${esc(profile.bio)}</p>` : ''}
    ${!statsResult.error ? `<div class="profile-stats" aria-label="Kullanıcı istatistikleri">
      <div class="profile-stat"><strong>${Number(stats.posts_count || 0)}</strong><span>Paylaşım</span></div>
      <div class="profile-stat"><strong>${Number(stats.likes_received || 0)}</strong><span>Beğeni</span></div>
      <div class="profile-stat"><strong>${Number(stats.comments_count || 0)}</strong><span>Yorum</span></div>
      <div class="profile-stat"><strong>${Number(engagement.counts?.followers || 0)}</strong><span>Takipçi</span></div>
      <div class="profile-stat"><strong>${Number(engagement.counts?.following || 0)}</strong><span>Takip</span></div>
      <div class="profile-stat"><strong>${Number(engagement.counts?.views || 0)}</strong><span>Görüntülenme</span></div>
      ${streak > 0 ? `<div class="profile-stat streak-stat" title="Ardışık üretim günü"><strong>🔥 ${streak}</strong><span>Gün serisi</span></div>` : ''}
    </div>` : ''}
    ${(() => { const L = levelInfo(Number(engagement.score || 0));
      return `<div class="level-strip"><span class="level-name">Sv. ${L.num} · ${esc(L.name)}</span>
        <div class="level-bar"><div class="level-fill" style="width:${L.pct}%"></div></div>
        <span class="small">${L.ceil ? `${Number(engagement.score || 0)}/${L.ceil}` : `${Number(engagement.score || 0)} · MAX`}</span></div>`; })()}
    ${currentUser && !isOwnProfile ? `<div class="profile-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 16px">
      ${hasBlockedYou ? '<span class="small">Bu kullanıcı seni engellemiş.</span>' : `
        <button class="btn ${isFollowing ? 'ghost' : 'primary'}" id="followBtn" type="button">${isFollowing ? 'Takipten çık' : 'Takip et'}</button>
        ${friendship?.status === 'accepted' ? '<span class="btn ghost">Arkadaşsınız</span>' : friendship?.status === 'pending' && friendship.sender_id === currentUser.id ? '<button class="btn ghost" id="cancelFriendBtn" type="button">İsteği iptal et</button>' : friendship?.status === 'pending' && friendship.receiver_id === currentUser.id ? '<button class="btn primary" id="acceptFriendBtn" type="button">Kabul et</button><button class="btn" id="rejectFriendBtn" type="button">Reddet</button>' : '<button class="btn ghost" id="addFriendBtn" type="button">Arkadaş ekle</button>'}
        ${isBlocked ? '<button class="btn danger" id="unblockBtn" type="button">Engeli kaldır</button>' : '<button class="btn ghost" id="blockBtn" type="button">Engelle</button>'}
        <a class="btn ghost" href="#/chat?with=${encodeURIComponent(profile.username || '')}">Mesaj gönder</a>
      `}
    </div>` : ''}
    ${badgeShelfHTML(engagement, specialBadges)}
    ${isOwnProfile ? `
      <section class="card">
        <h2>Profili düzenle</h2>
        <form id="profileForm">
          <div class="field">
            <label for="profileDisplayName">Görünen ad</label>
            <input id="profileDisplayName" name="display_name" required maxlength="60" value="${esc(profile.display_name || '')}">
          </div>
          <div class="field">
            <label for="profileUsername">Kullanıcı adı</label>
            <input id="profileUsername" name="username" required minlength="3" maxlength="20" pattern="[a-z0-9_]{3,20}" title="3-20 karakter: küçük harf, rakam ve alt çizgi" value="${esc(profile.username || '')}">
          </div>
          <div class="field">
            <label for="profileBio">Hakkımda</label>
            <textarea id="profileBio" name="bio" maxlength="500" placeholder="Kendinden kısaca bahset…">${esc(profile.bio || '')}</textarea>
          </div>
          <button class="btn primary" type="submit">Profili kaydet</button>
          <div id="profileMessage" class="message" aria-live="polite"></div>
        </form>
      </section>
    ` : ''}
    <div class="section-head"><h2>Eserleri</h2></div>
    ${error ? `<div class="empty">Eserler yüklenemedi.<br><span class="small">${esc(error.message)}</span></div>`
      : !profilePosts.length ? '<div class="empty">Henüz bir eser paylaşılmamış.</div>'
      : profilePosts.map(post => `
      <article class="card">
        <div class="meta">
          <span>${esc(quickTypeLabel(post))}</span>
          <span>· ${esc(formatDate(post.created_at))}</span>
        </div>
        ${postCoverHTML(post)}
        ${mediaHTML(post)}
        <h3><a href="#/read/${encodeURIComponent(post.id)}">${esc(post.title || 'Başlıksız eser')}</a></h3>
        <div class="post-tags">${hashtagHTML(post)}</div>
        <p>${esc(post.description || '')}</p>
      </article>`).join('')}
    ${isOwnProfile && historyPosts.length ? `<section class="saved-section">
      <div class="section-head"><div><div class="eyebrow">Geçmiş</div><h2>Son görüntülediklerim</h2></div><button class="btn ghost small" id="clearHistoryBtn" type="button">Geçmişi temizle</button></div>
      <div class="saved-grid">${historyPosts.map(post => `<article class="card saved-card">
        <div class="meta"><span>${esc(quickTypeLabel(post))}</span></div>
        ${postCoverHTML(post)}${mediaHTML(post)}
        <h3><a href="#/read/${encodeURIComponent(post.id)}">${esc(post.title || 'Başlıksız eser')}</a></h3>
        <div class="meta">Yazar: <a href="#/user/${encodeURIComponent(post.author_id)}">${esc(displayName(historyProfileMap[post.author_id]))}</a></div>
      </article>`).join('')}</div>
    </section>` : ''}
    ${isOwnProfile ? `<section class="saved-section">
      <div class="section-head"><div><div class="eyebrow">Sana özel</div><h2>Kaydettiklerim</h2></div><div style="display:flex;gap:8px"><a class="btn ghost small" href="#/koleksiyonlar">📚 Koleksiyonlarım</a><a class="btn ghost small" href="#/ozet">📊 Halka Özetim</a></div></div>
      ${savedPostsError ? `<div class="empty">Kaydedilen eserler yüklenemedi.<br><span class="small">Veritabanı güncellemesi gerekebilir: ${esc(savedPostsError.message)}</span></div>`
        : !savedPosts.length ? '<div class="empty">Henüz bir eser kaydetmedin.<br>Ana sayfadaki Kaydet düğmesiyle okuma listeni oluşturabilirsin.</div>'
        : `<div class="saved-grid">${savedPosts.map(post => `<article class="card saved-card">
          <div class="meta"><span>${esc(quickTypeLabel(post))}</span><span>· ${esc(formatDate(post.created_at))}</span></div>
          ${postCoverHTML(post)}${mediaHTML(post)}
          <h3><a href="#/read/${encodeURIComponent(post.id)}">${esc(post.title || 'Başlıksız eser')}</a></h3>
          <div class="post-tags">${hashtagHTML(post)}</div>
          <p>${esc(post.description || '')}</p>
          <div class="meta">Yazar: <a href="#/user/${encodeURIComponent(post.author_id)}">${esc(displayName(savedProfileMap[post.author_id]))}</a></div>
          <div class="post-actions">${saveButtonHTML(post.id, true)}</div>
        </article>`).join('')}</div>`}
    </section>` : ''}
    </main>
  `;

  document.getElementById('clearHistoryBtn')?.addEventListener('click', async () => {
    if (!confirm('Görüntüleme geçmişin silinsin mi?')) return;
    const { error } = await sb.from('view_history').delete().eq('user_id', currentUser.id);
    if (error) { alert('Geçmiş silinemedi: ' + error.message); return; }
    renderProfile('me');
  });
  document.getElementById('profileForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const display_name = String(form.get('display_name') || '').trim();
    const username = String(form.get('username') || '').trim().toLowerCase();
    const bio = String(form.get('bio') || '').trim();
    const button = e.currentTarget.querySelector('button[type="submit"]');
    const message = document.getElementById('profileMessage');
    if (!display_name) {
      message.textContent = 'Görünen ad boş bırakılamaz.';
      message.className = 'message error';
      return;
    }
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      message.textContent = 'Kullanıcı adı 3–20 karakter olmalı; küçük harf, rakam ve alt çizgi kullan.';
      message.className = 'message error';
      return;
    }
    button.disabled = true;
    button.textContent = 'Kaydediliyor…';
    const { error: updateError } = await sb.from('profiles')
      .update({ username, display_name, bio })
      .eq('id', currentUser.id);
    button.disabled = false;
    button.textContent = 'Profili kaydet';
    if (updateError) {
      message.textContent = updateError.code === '23505' || /profiles_username_unique/.test(updateError.message || '')
        ? 'Bu kullanıcı adı başka bir hesapta kullanılıyor.'
        : `Profil kaydedilemedi: ${updateError.message}`;
      message.className = 'message error';
      return;
    }
    await loadProfile();
    await renderProfile('me');
  });
  bindSaveButtons(app);
  app.querySelector('.badge-shelf')?.addEventListener('click', e => {
    const slot = e.target.closest('[data-badge],[data-track]');
    if (!slot) return;
    const c = engagement.counts || {};
    if (slot.dataset.track) {
      const t = TRACK_DEFS.find(x => x.key === slot.dataset.track);
      if (!t) return;
      const val = t.key === 'likes' ? (c.likes || 0) : t.key === 'followers' ? (c.followers || 0) : t.key === 'bugs' ? (c.bugs || 0) : ((c.type_counts || {})[t.key] || 0);
      let stage = 0;
      while (stage < t.need.length && val >= t.need[stage]) stage++;
      const next = t.need[stage];
      const prev = stage > 0 ? t.need[stage - 1] : 0;
      openBadgeModal({
        icon: t.icon, name: `${t.name} izi`, desc: `Aşamalar: ${t.stages.join(' → ')}`,
        earnedAt: stage ? badgeEarnedAt[`trk_${({ writing:'yazi', drawing:'cizim', photo:'foto', video:'video', music:'muzik', likes:'begeni', followers:'takip', bugs:'katki' })[t.key]}_${stage}`] : null,
        progText: next ? `Sonraki aşama: ${t.stages[stage]} — ${val}/${next}` : 'Son aşamadasın.',
        pct: next ? Math.min(100, Math.round((val - prev) / (next - prev) * 100)) : 100
      });
      return;
    }
    const key = slot.dataset.badge;
    const def = resolveBadge(key, specialBadges);
    const has = (engagement.earned_keys || []).includes(key);
    const isSecretLocked = def.secret && !has;
    openBadgeModal({
      icon: isSecretLocked ? '🔒' : def.icon,
      name: isSecretLocked ? '???' : def.name,
      desc: isSecretLocked ? 'Gizli rozet — nasıl kazanıldığını keşfet.' : (def.desc || ''),
      earnedAt: has ? badgeEarnedAt[key] : null,
      rarity: !has && isSecretLocked ? '' : badgeRarityText(key, badgeStats),
      progText: !has && def.prog ? `${Math.min(c[def.prog] || 0, def.total)}/${def.total}` : '',
      pct: !has && def.prog ? Math.min(100, Math.round((c[def.prog] || 0) / def.total * 100)) : 0,
      canFeature: isOwnProfile && has,
      isFeatured: profile.featured_badge === key,
      badgeKey: key
    });
  });
  if (isOwnProfile && (engagement.newly_earned || []).length) {
    const names = engagement.newly_earned.map(k => resolveBadge(k, specialBadges).name);
    const toast = document.createElement('div');
    toast.className = 'badge-toast';
    toast.innerHTML = `<strong>Yeni rozet${names.length > 1 ? 'ler' : ''} kazandın!</strong><br>${esc(names.join(' · '))}`;
    document.body.appendChild(toast);
    setTimeout(() => { toast.classList.add('show'); }, 50);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 5000);
    cemberCelebrate(`Tebrikler! ${names.join(', ')} rozetini kazandın! Rozet rafında görüntüleyebilir, hatta profilinde öne çıkarabilirsin.`);
  }
  if (!isOwnProfile && currentUser) {
    document.getElementById('followBtn')?.addEventListener('click', async e => {
      const followBtnEl = e.currentTarget;
      followBtnEl.disabled = true;
      const { error } = isFollowing
        ? await sb.from('follows').delete().eq('follower_id', currentUser.id).eq('followed_id', userId)
        : await sb.from('follows').insert({ follower_id: currentUser.id, followed_id: userId });
      if (error) { alert(isFollowing ? 'Takip bırakılamadı: ' + error.message : 'Takip edilemedi: ' + error.message); followBtnEl.disabled = false; return; }
      await renderProfile(userId);
    });
    document.getElementById('addFriendBtn')?.addEventListener('click', async () => {
      const { error } = await sb.from('friend_requests').insert({ sender_id: currentUser.id, receiver_id: userId });
      if (error) { alert('Arkadaşlık isteği gönderilemedi: ' + error.message); return; }
      await renderProfile(userId);
    });
    document.getElementById('cancelFriendBtn')?.addEventListener('click', async () => {
      if (!friendship) return;
      const { error } = await sb.from('friend_requests').delete().eq('id', friendship.id);
      if (error) { alert('İstek iptal edilemedi: ' + error.message); return; }
      await renderProfile(userId);
    });
    document.getElementById('acceptFriendBtn')?.addEventListener('click', async () => {
      if (!friendship) return;
      const { error } = await sb.from('friend_requests').update({ status: 'accepted', updated_at: new Date().toISOString() }).eq('id', friendship.id);
      if (error) { alert('İstek kabul edilemedi: ' + error.message); return; }
      await renderProfile(userId);
    });
    document.getElementById('rejectFriendBtn')?.addEventListener('click', async () => {
      if (!friendship) return;
      const { error } = await sb.from('friend_requests').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', friendship.id);
      if (error) { alert('İstek reddedilemedi: ' + error.message); return; }
      await renderProfile(userId);
    });
    document.getElementById('blockBtn')?.addEventListener('click', async () => {
      if (!confirm('Bu kullanıcıyı engellemek istediğine emin misin?')) return;
      const { error } = await sb.from('blocks').insert({ blocker_id: currentUser.id, blocked_id: userId });
      if (error) { alert('Engelleme başarısız: ' + error.message); return; }
      await renderProfile(userId);
    });
    document.getElementById('unblockBtn')?.addEventListener('click', async () => {
      const { error } = await sb.from('blocks').delete().eq('blocker_id', currentUser.id).eq('blocked_id', userId);
      if (error) { alert('Engel kaldırılamadı: ' + error.message); return; }
      await renderProfile(userId);
    });
  }
}

function renderLegalPage(type = 'terms') {
  const content = {
    terms: `<div class="eyebrow">Taslak · ${LEGAL_VERSIONS.terms}</div><h1>Kullanıcı Sözleşmesi</h1>
      <p>HALKA; kullanıcıların yazı, kitap, çizim, fotoğraf ve kısa video paylaşabildiği bir topluluk alanıdır. Hesap açarak bu sözleşmeyi kabul etmiş olursun.</p>
      <h2>Hesap ve güvenlik</h2><p>Doğru bilgiler vermeli, hesabının erişim bilgilerini korumalı ve hesabındaki hareketlerden sorumlu olmalısın. Başkasına ait hesapları kullanamaz veya platform güvenliğini aşmaya çalışamazsın.</p>
      <h2>İçerik ve haklar</h2><p>Paylaştığın içerik üzerindeki hakların sende kalır. İçeriği HALKA’da gösterebilmemiz ve seçtiğin gizlilik ayarına göre diğer kullanıcılara sunabilmemiz için sınırlı bir yayınlama ve barındırma izni verirsin. Yüklemek için gerekli haklara sahip olduğun içerikleri paylaşmalısın.</p>
      <h2>Yasak içerik ve yaptırımlar</h2><p>Yasa dışı, tehdit edici, taciz edici, başkasının haklarını ihlal eden veya zararlı yazılım içeren içerikler paylaşma. Kurallara aykırı içerik kaldırılabilir; ihlalin niteliğine göre hesabın kısıtlanabilir veya kapatılabilir.</p>
      <h2>Hizmet ve değişiklikler</h2><p>HALKA geliştirme aşamasındadır. Özellikler zamanla değişebilir. Sözleşme güncellendiğinde yeni sürüm ve yürürlük tarihi gösterilir; gerekli durumlarda yeniden onay istenir.</p>
      <p class="small">Bu metin ilk ürün taslağıdır; yürürlük ve iletişim bilgileri yayın öncesi netleştirilmelidir.</p>`,
    privacy: `<div class="eyebrow">Taslak · ${LEGAL_VERSIONS.privacy}</div><h1>Gizlilik ve KVKK Aydınlatma Metni</h1>
      <p><strong>Veri sorumlusu:</strong> Masked Turkish. <strong>Başvuru e-postası:</strong> halka.destek1@gmail.com.</p>
      <h2>İşlenen veriler</h2><p>Hesap ve profil bilgileri (e-posta, kullanıcı adı, görünen ad, biyografi, profil ve kapak görseli), paylaşımlar, yorumlar, beğeniler, sohbet içerikleri ve güvenlik/işlem kayıtları işlevlere göre işlenebilir. Şifreler Supabase Auth tarafından yönetilir; HALKA uygulaması şifreni profil tablosunda tutmaz.</p>
      <h2>Amaç ve hukuki sebep</h2><p>Veriler hesap oluşturma ve oturum açma, sosyal özellikleri sunma, kullanıcı tercihlerini uygulama, kötüye kullanımı önleme ve hizmetin güvenliğini sağlama amaçlarıyla işlenir. Her amaç için geçerli hukuki sebep ve saklama süresi, veri sorumlusunca yayın öncesinde belirlenmelidir.</p>
      <h2>Alıcılar ve yurt dışı aktarımı</h2><p>Uygulama verileri Supabase altyapısında barındırılır; Google ile giriş seçilirse kimlik doğrulama Google üzerinden yürür. Sağlayıcıların ülkesi, aktarım koşulu, alıcı grupları ve gerekli güvence bilgileri yayın öncesinde veri sorumlusunca teyit edilmelidir.</p>
      <h2>Toplama yöntemi ve hakların</h2><p>Veriler hesap formları, uygulama kullanımı ve içerik yüklemeleri aracılığıyla elektronik ortamda toplanır. KVKK kapsamındaki başvuru ve haklarını, kimlik teyidi için gerekli bilgilerle birlikte yukarıdaki başvuru adresine iletebilirsin. Başvurular ilgili mevzuattaki usul ve süreler içinde yanıtlanır.</p>
      <p class="small">Bu metin taslaktır. Veri sorumlusunun kimliği, hukuki sebepler, saklama süreleri, aktarım detayları ve başvuru kanalı teyit edilmeden nihai aydınlatma metni olarak kullanılmamalıdır.</p>`,
    community: `<div class="eyebrow">Taslak · ${LEGAL_VERSIONS.community}</div><h1>Topluluk Kuralları</h1>
      <p>HALKA’da farklı hikâyeler ve üretimler saygıyla buluşur. Katılırken şu kuralları kabul edersin:</p><h2>Saygılı iletişim</h2><p>Taciz, nefret söylemi, tehdit, kişisel bilgileri izinsiz yayma ve hedef gösterme yasaktır.</p><h2>Haklara saygı</h2><p>Yalnızca paylaşma hakkına sahip olduğun yazı, çizim, fotoğraf ve videoları yükle. Başkasının eserini kendininmiş gibi sunma.</p><h2>Güvenli paylaşımlar</h2><p>Dolandırıcılık, spam, zararlı bağlantı, yasa dışı içerik ve başkalarını tehlikeye sokabilecek yönlendirmeler paylaşma. Sorunlu içeriği HALKA yönetimine bildir.</p><h2>Uygulama</h2><p>İhlaller içerik kaldırma, özellik kısıtlama veya hesabı askıya alma sonucunu doğurabilir. Kararlara itiraz için HALKA destek kanalı yayınlandığında oradan başvurabilirsin.</p>
      <p class="small">İletişim/itiraz kanalı bilgisi yayın öncesinde eklenecek.</p>`
  };
  const title = LEGAL_LABELS[type] || LEGAL_LABELS.terms;
  app.innerHTML = `<section class="hero"><div class="eyebrow">HALKA belgeleri</div><div class="legal-document">${content[type] || content.terms}</div><p><a class="btn ghost" href="#/auth?signup">Kayıt ekranına dön</a></p></section>`;
  document.title = `${title} — Halka`;
}

async function renderMfaManager(forceEnroll = false) {
  const box = document.getElementById('mfaManager');
  if (!box) return;
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error) { box.innerHTML = `<div class="message error">MFA ayarları yüklenemedi: ${esc(error.message)}</div>`; return; }
  const verifiedFactors = (data?.totp || []).filter(factor => factor.status === 'verified');
  const verified = forceEnroll ? null : verifiedFactors[0];
  if (verified) {
    box.innerHTML = `<p class="message">İki adımlı doğrulama etkin · ${verifiedFactors.length} cihaz</p>
      <p class="small">Kurtarma kodu bu sürümde bulunmuyor. İkinci bir cihazı yedek olarak bağlamanı öneririz.</p>
      <button class="btn ghost" id="mfaAddBackupBtn" type="button">Yedek doğrulama cihazı ekle</button>
      <button class="btn danger" id="mfaRemoveBtn" type="button">Bir doğrulama cihazını kaldır</button>
      <div id="mfaManageMessage" class="message" aria-live="polite"></div>`;
    document.getElementById('mfaAddBackupBtn').addEventListener('click', () => renderMfaManager(true));
    document.getElementById('mfaRemoveBtn').addEventListener('click', () => {
      box.insertAdjacentHTML('beforeend', `<form id="mfaRemoveForm" class="field"><label for="mfaRemoveCode">Doğrulama uygulamasındaki 6 haneli kod</label><input id="mfaRemoveCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required><button class="btn ghost" type="submit">Kodu doğrula ve kapat</button></form>`);
      const form = document.getElementById('mfaRemoveForm');
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const message = document.getElementById('mfaManageMessage');
        const code = document.getElementById('mfaRemoveCode').value.trim();
        const { error: verifyError } = await sb.auth.mfa.challengeAndVerify({ factorId: verified.id, code });
        if (verifyError) return setSettingsMessage(message, `Kod doğrulanamadı: ${verifyError.message}`, true);
        const { error: removeError } = await sb.auth.mfa.unenroll({ factorId: verified.id });
        if (removeError) return setSettingsMessage(message, `Doğrulama kapatılamadı: ${removeError.message}`, true);
        await sb.auth.refreshSession();
        await renderMfaManager();
      });
    });
    return;
  }
  const pending = (data?.totp || []).find(factor => factor.status === 'unverified');
  box.innerHTML = `<p class="small">${verifiedFactors.length ? 'Yedek doğrulama cihazını bağla.' : 'Henüz bir doğrulama uygulaması bağlanmamış.'}</p>
    <button class="btn primary" id="mfaEnrollBtn" type="button">Doğrulama uygulaması ekle</button>
    <div id="mfaEnrollFlow"></div>`;
  const enrollButton = document.getElementById('mfaEnrollBtn');
  enrollButton.addEventListener('click', async () => {
    enrollButton.disabled = true;
    const result = pending ? { data: pending } : await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'HALKA doğrulama' });
    if (result.error) {
      enrollButton.disabled = false;
      document.getElementById('mfaEnrollFlow').innerHTML = `<div class="message error">Kurulum başlatılamadı: ${esc(result.error.message)}</div>`;
      return;
    }
    const factor = result.data;
    document.getElementById('mfaEnrollFlow').innerHTML = `
      <div class="field"><p>QR kodunu Google Authenticator, Microsoft Authenticator veya benzer bir uygulamayla tara. Tarayamıyorsan bu anahtarı elle ekle:</p>
      ${factor.totp?.qr_code ? `<img src="${esc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(factor.totp.qr_code)}`)}" alt="İki adımlı doğrulama QR kodu" style="width:190px;height:190px;background:white;padding:8px;border-radius:10px">` : ''}
      <p class="small">Kurulum anahtarı: <code>${esc(factor.totp?.secret || '')}</code></p></div>
      <form id="mfaVerifyForm" class="field"><label for="mfaVerifyCode">Uygulamadaki 6 haneli kod</label>
      <input id="mfaVerifyCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>
      <button class="btn primary" type="submit">Kurulumu doğrula</button><div id="mfaVerifyMessage" class="message" aria-live="polite"></div></form>`;
    document.getElementById('mfaVerifyForm').addEventListener('submit', async event => {
      event.preventDefault();
      const message = document.getElementById('mfaVerifyMessage');
      const code = document.getElementById('mfaVerifyCode').value.trim();
      const { error: verifyError } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (verifyError) return setSettingsMessage(message, `Kod doğrulanamadı: ${verifyError.message}`, true);
      await renderMfaManager();
    });
  });
}

async function requireMfaChallenge() {
  if (!currentUser) return false;
  try {
    const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!error && data?.nextLevel === 'aal2' && data?.currentLevel !== 'aal2') {
      if (location.hash !== '#/auth?mfa') location.hash = '#/auth?mfa';
      return true;
    }
  } catch {}
  return false;
}

async function renderMfaChallenge() {
  if (!currentUser) { location.hash = '#/auth?login'; return; }
  const { data, error } = await sb.auth.mfa.listFactors();
  const factors = (data?.totp || []).filter(item => item.status === 'verified');
  const factor = factors[0];
  if (error || !factor) {
    app.innerHTML = `<section class="card form-card"><h1>Doğrulama açılamadı</h1><p class="message error">${esc(error?.message || 'Hesabında etkin bir doğrulama uygulaması bulunamadı.')}</p><p><button class="btn ghost" id="mfaExitBtn" type="button">Güvenli şekilde çıkış yap</button></p></section>`;
    document.getElementById('mfaExitBtn').addEventListener('click', async () => { await sb.auth.signOut(); currentUser = null; location.hash = '#/auth?login'; });
    return;
  }
  app.innerHTML = `<section class="card form-card"><div class="eyebrow">Hesap güvenliği</div><h1>Girişini doğrula</h1><p class="subtitle">Doğrulama uygulamandaki 6 haneli kodu gir.</p>
    <form id="mfaChallengeForm">${factors.length > 1 ? `<div class="field"><label for="mfaFactor">Doğrulama cihazı</label><select id="mfaFactor">${factors.map(item => `<option value="${esc(item.id)}">${esc(item.friendly_name || 'Doğrulama uygulaması')}</option>`).join('')}</select></div>` : ''}<div class="field"><label for="mfaChallengeCode">Doğrulama kodu</label><input id="mfaChallengeCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div>
    <button class="btn primary" type="submit">Devam et</button><div id="mfaChallengeMessage" class="message" aria-live="polite"></div></form></section>`;
  document.getElementById('mfaChallengeForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const message = document.getElementById('mfaChallengeMessage');
    button.disabled = true;
    const code = document.getElementById('mfaChallengeCode').value.trim();
    const factorId = document.getElementById('mfaFactor')?.value || factor.id;
    const { error: verifyError } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
    button.disabled = false;
    if (verifyError) return setSettingsMessage(message, `Kod doğrulanamadı: ${verifyError.message}`, true);
    location.hash = '#/';
  });
}

async function renderAdmin() {
  if (!currentUser) { location.hash = '#/auth?login'; return; }
  const { data: admin, error: accessError } = await sb.rpc('is_current_user_admin');
  if (accessError || admin !== true) {
    app.innerHTML = '<div class="empty">Sayfa bulunamadı.</div>';
    return;
  }
  app.innerHTML = loadingBlock('Yönetim paneli açılıyor…');
  isCurrentUserAdmin = true;
  setNav();
  const [{ data: reports, error: reportsError }, { data: actions, error: actionsError }, { data: flags, error: flagsError }, { data: bugReports }, { data: stats }] = await Promise.all([
    sb.from('content_reports').select('*').order('created_at', { ascending: false }).limit(100),
    sb.from('moderation_actions').select('*').order('created_at', { ascending: false }).limit(30),
    sb.from('content_flags').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(100),
    sb.from('bug_reports').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(50),
    sb.rpc('admin_stats')
  ]);
  if (reportsError || actionsError) {
    app.innerHTML = `<section class="card"><h1>Yönetim paneli</h1><p class="message error">Yönetim verileri yüklenemedi. Veritabanı güncellemesinin çalıştırıldığını kontrol et.<br><span class="small">${esc(reportsError?.message || actionsError?.message || '')}</span></p></section>`;
    return;
  }
  const rows = reports || [];
  const flagRows = flags || [];
  const bugRows = bugReports || [];
  const bugScreenshotPaths = bugRows.map(b => b.screenshot_path).filter(Boolean);
  const { data: bugScreenshots } = bugScreenshotPaths.length
    ? await sb.storage.from('bug-reports').createSignedUrls(bugScreenshotPaths, 3600)
    : { data: [] };
  const bugScreenshotUrls = Object.fromEntries((bugScreenshots || []).filter(s => s.signedUrl).map(s => [s.path, s.signedUrl]));
  const postIds = [...new Set([
    ...rows.filter(r => r.target_type === 'post' && r.status === 'open').map(r => r.target_id),
    ...flagRows.filter(f => f.target_type === 'post').map(f => f.target_id)
  ])];
  const commentIds = [...new Set([
    ...rows.filter(r => r.target_type === 'comment' && r.status === 'open').map(r => r.target_id),
    ...flagRows.filter(f => f.target_type === 'comment').map(f => f.target_id)
  ])];
  const userIds = [...new Set([...rows.flatMap(r => [r.target_author_id, r.reporter_id]), ...flagRows.map(f => f.target_author_id), ...bugRows.map(b => b.user_id)].filter(Boolean))];
  const [postsResult, commentsResult, profilesResult] = await Promise.all([
    postIds.length ? sb.from('posts').select('id,title,description,author_id').in('id', postIds) : Promise.resolve({ data: [] }),
    commentIds.length ? sb.from('comments').select('id,body,author_id').in('id', commentIds) : Promise.resolve({ data: [] }),
    userIds.length ? sb.from('profiles').select('id,username,display_name,is_suspended').in('id', userIds) : Promise.resolve({ data: [] })
  ]);
  const posts = Object.fromEntries((postsResult.data || []).map(p => [String(p.id), p]));
  const comments = Object.fromEntries((commentsResult.data || []).map(c => [String(c.id), c]));
  const profiles = Object.fromEntries((profilesResult.data || []).map(p => [p.id, p]));
  const reasonLabels = { spam: 'Spam', harassment: 'Taciz veya zorbalık', copyright: 'Telif hakkı', unsafe: 'Güvenli olmayan içerik', other: 'Diğer' };
  const actionLabels = { resolve: 'Çözüldü', dismiss: 'Reddedildi', remove_content: 'İçerik kaldırıldı', suspend_user: 'Hesap kısıtlandı', restore_user: 'Hesap kısıtlaması kaldırıldı' };
  const userLabel = userId => {
    const p = profiles[userId];
    return p ? `${esc(displayName(p))} (@${esc(p.username || 'kullanıcı')})` : esc(userId || 'Silinmiş kullanıcı');
  };
  const openRows = rows.filter(r => r.status === 'open');
  const reportCards = openRows.map(r => {
    const target = r.target_type === 'post' ? posts[r.target_id] : comments[r.target_id];
    const targetText = target ? (r.target_type === 'post' ? `${target.title || 'Başlıksız eser'} — ${target.description || ''}` : target.body) : 'İçerik artık mevcut değil.';
    const suspended = profiles[r.target_author_id]?.is_suspended;
    return `<article class="card admin-report" data-report-id="${esc(r.id)}" style="margin:14px 0">
      <div class="meta"><strong>${r.target_type === 'post' ? 'Eser' : 'Yorum'} bildirimi</strong><span>${esc(formatDate(r.created_at))}</span><span>${esc(reasonLabels[r.reason] || r.reason)}</span></div>
      <p>${esc(String(targetText).slice(0, 1400))}</p>
      <p class="small">Bildiren: ${userLabel(r.reporter_id)} · İçeriği paylaşan: ${userLabel(r.target_author_id)}</p>
      ${r.details ? `<p class="small">Açıklama: ${esc(r.details)}</p>` : ''}
      <div class="admin-actions" style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn primary small" data-action="resolve" type="button">Çözüldü olarak işaretle</button>
        <button class="btn ghost small" data-action="dismiss" type="button">Bildirimi reddet</button>
        ${target ? `<button class="btn danger small" data-action="remove_content" type="button">İçeriği kaldır</button>` : ''}
        <button class="btn ghost small" data-action="${suspended ? 'restore_user' : 'suspend_user'}" type="button">${suspended ? 'Hesap kısıtlamasını kaldır' : 'Hesabı kısıtla'}</button>
      </div><div class="message small" aria-live="polite"></div>
    </article>`;
  }).join('');
  const flagTypeLabel = { post: 'Eser', comment: 'Yorum', message: 'Sohbet mesajı' };
  const flagCards = flagRows.map(f => {
    const target = f.target_type === 'post' ? posts[f.target_id] : f.target_type === 'comment' ? comments[f.target_id] : null;
    const targetText = f.source === 'media'
      ? (target ? `${target.title || 'Başlıksız eser'} — medya içeriği` : 'Medya eseri (içerik incelenmeli)')
      : (f.excerpt || (target ? (target.body || target.title || '') : 'İçerik artık mevcut değil.'));
    const suspended = profiles[f.target_author_id]?.is_suspended;
    const openLink = f.target_type === 'post' ? `<a class="btn ghost small" href="#/read/${encodeURIComponent(f.target_id)}">Eseri aç</a>` : '';
    return `<article class="card admin-flag" data-flag-id="${esc(f.id)}" style="margin:14px 0">
      <div class="meta"><strong>⚑ Otomatik yakalama · ${esc(flagTypeLabel[f.target_type] || f.target_type)}</strong><span>${esc(formatDate(f.created_at))}</span><span>${f.source === 'media' ? 'Medya incelemesi' : 'Terim eşleşmesi'}</span></div>
      <p>${esc(String(targetText).slice(0, 1400))}</p>
      ${f.matched_terms?.length ? `<p class="small">Eşleşen terimler: ${esc(f.matched_terms.join(', '))}</p>` : ''}
      <p class="small">Paylaşan: ${userLabel(f.target_author_id)}</p>
      <div class="admin-actions" style="display:flex;gap:8px;flex-wrap:wrap">
        ${openLink}
        <button class="btn ghost small" data-action="dismiss" type="button">Sorun yok</button>
        <button class="btn danger small" data-action="remove_content" type="button">İçeriği kaldır</button>
        <button class="btn ghost small" data-action="${suspended ? 'restore_user' : 'suspend_user'}" type="button">${suspended ? 'Hesap kısıtlamasını kaldır' : 'Hesabı kısıtla'}</button>
      </div><div class="message small" aria-live="polite"></div>
    </article>`;
  }).join('');
  const bugCards = bugRows.map(b => {
    const shotUrl = b.screenshot_path ? bugScreenshotUrls[b.screenshot_path] : null;
    return `<article class="card admin-bug" data-bug-id="${esc(b.id)}" style="margin:14px 0">
      <div class="meta"><strong>Hata bildirimi</strong><span>${esc(formatDate(b.created_at))}</span></div>
      <p>${esc(String(b.description || '').slice(0, 1400))}</p>
      <p class="small">Bildiren: ${userLabel(b.user_id)}</p>
      ${shotUrl ? `<a href="${esc(shotUrl)}" target="_blank" rel="noopener"><img src="${esc(shotUrl)}" alt="Ekran görüntüsü" style="max-width:100%;max-height:320px;border-radius:8px;margin:8px 0"></a>` : ''}
      <div class="admin-actions" style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn primary small" data-action="resolve" type="button">Çözüldü olarak işaretle</button>
        <button class="btn ghost small" data-action="dismiss" type="button">Kapat</button>
      </div><div class="message small" aria-live="polite"></div>
    </article>`;
  }).join('');
  const history = (actions || []).map(a => `<article class="card" style="margin:10px 0;padding:14px"><strong>${esc(actionLabels[a.action] || a.action)}</strong><span class="small"> · ${esc(formatDate(a.created_at))}</span><div class="small">${esc(a.target_type)} · ${esc(a.target_id)}${a.notes ? ` · ${esc(a.notes)}` : ''}</div></article>`).join('');
  const statsHtml = stats ? `<div class="admin-stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin:18px 0">
    ${[['Kullanıcı', stats.users], ['Eser', stats.posts], ['Yorum', stats.comments], ['Topluluk', stats.communities], ['Kısıtlı', stats.suspended_users], ['Açık bildirim', stats.open_reports], ['Yakalama', stats.pending_flags], ['Hata', stats.open_bug_reports]]
      .map(([label, value]) => `<div class="card" style="padding:12px;text-align:center"><div style="font-size:1.5rem;font-weight:700">${esc(String(value ?? 0))}</div><div class="small">${esc(label)}</div></div>`).join('')}
  </div>` : '';
  app.innerHTML = `<section class="hero"><div class="eyebrow">HALKA güvenliği</div><h1>Yönetim paneli</h1><p class="subtitle">${openRows.length} açık bildirim · ${flagRows.length} otomatik yakalama · ${bugRows.length} hata bildirimi</p></section>
    ${statsHtml}
    <section class="card" style="margin:18px 0"><h2>Kullanıcı ara</h2>
      <form id="adminUserSearchForm" style="display:flex;gap:8px;align-items:end;flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:180px;margin:0"><label for="adminUserSearch">Kullanıcı adı (eski ad da olur)</label><input id="adminUserSearch" required maxlength="20" placeholder="kullanici_adi"></div>
        <button class="btn primary" type="submit">Ara</button>
      </form>
      <div id="adminUserResult" style="margin-top:12px"></div>
    </section>
    <section class="card" style="margin:18px 0"><h2>Özel rozet ver</h2>
      <form id="grantBadgeForm">
        <div class="field"><label for="grantBadgeUser">Kullanıcı adı</label><input id="grantBadgeUser" required maxlength="20" placeholder="kullanici_adi"></div>
        <div class="field"><label for="grantBadgeName">Rozet adı</label><input id="grantBadgeName" required maxlength="40" placeholder="Örn. Yılın Dostu"></div>
        <div class="field"><label for="grantBadgeDesc">Açıklama (isteğe bağlı)</label><input id="grantBadgeDesc" maxlength="140" placeholder="Neden verildiği"></div>
        <div class="field"><label for="grantBadgeIcon">İkon (emoji)</label><input id="grantBadgeIcon" maxlength="4" placeholder="✦"></div>
        <button class="btn primary" type="submit">Rozeti ver</button>
        <div id="grantBadgeMessage" class="message" aria-live="polite"></div>
      </form>
    </section>
    <section class="card" style="margin:18px 0"><h2>Özel rozetleri düzenle</h2>
      <div id="customBadgeList">${loadingBlock('Rozetler yükleniyor…')}</div>
      <form id="editBadgeForm" hidden style="margin-top:14px;border-top:1px solid var(--line);padding-top:14px">
        <input type="hidden" id="editBadgeKey">
        <div class="field"><label for="editBadgeName">Rozet adı</label><input id="editBadgeName" required maxlength="40"></div>
        <div class="field"><label for="editBadgeDesc">Açıklama</label><input id="editBadgeDesc" maxlength="140"></div>
        <div class="field"><label for="editBadgeIcon">İkon (emoji)</label><input id="editBadgeIcon" maxlength="4"></div>
        <button class="btn primary" type="submit">Kaydet</button>
        <button class="btn ghost" id="editBadgeCancel" type="button">Vazgeç</button>
        <div id="editBadgeMessage" class="message" aria-live="polite"></div>
      </form>
    </section>
    <section class="card" style="margin:18px 0"><h2>🎨 Haftalık tema</h2>
      <div id="themeList">${loadingBlock('Temalar yükleniyor…')}</div>
      <form id="themeForm" style="margin-top:14px">
        <div class="field"><label for="themeTitle">Tema adı</label><input id="themeTitle" required maxlength="80" placeholder="Örn. Kayıp Şehir"></div>
        <div class="field"><label for="themePrompt">Yönlendirme (isteğe bağlı)</label><input id="themePrompt" maxlength="300" placeholder="Bu temayla ne üretilsin?"></div>
        <div class="field" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div><label for="themeStart">Başlangıç</label><input id="themeStart" type="date" required></div>
          <div><label for="themeEnd">Bitiş</label><input id="themeEnd" type="date" required></div>
        </div>
        <button class="btn primary" type="submit">Temayı aç</button>
        <div id="themeMessage" class="message" aria-live="polite"></div>
      </form>
    </section>
    ${bugCards ? `<section><h2>Hata bildirimleri</h2>${bugCards}</section>` : ''}
    ${flagCards ? `<section style="margin-top:32px"><h2>Otomatik yakalamalar</h2>${flagCards}</section>` : ''}
    <section${flagCards || bugCards ? ' style="margin-top:32px"' : ''}><h2>İnceleme kuyruğu</h2>${reportCards || '<div class="empty">Açık bildirim yok.</div>'}</section>
    <section style="margin-top:32px"><h2>Son yönetim işlemleri</h2>${history || '<div class="empty">Henüz işlem kaydı yok.</div>'}</section>`;
  document.getElementById('adminUserSearchForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const username = document.getElementById('adminUserSearch').value.trim().replace(/^@+/, '').toLowerCase();
    const box = document.getElementById('adminUserResult');
    const { data, error } = await sb.rpc('admin_user_history', { p_username: username });
    if (error) { box.innerHTML = `<div class="message error">${esc(error.message)}</div>`; return; }
    const fieldLabel = { username: 'Kullanıcı adı', display_name: 'Görünen ad' };
    const historyRows = (data.changes || []).map(c => `<div class="small">${esc(fieldLabel[c.field] || c.field)}: ${esc(c.old || '—')} → ${esc(c.new || '—')} · ${esc(formatDate(c.at))}</div>`).join('');
    box.innerHTML = `<div class="card" style="padding:14px">
      <div><strong>${esc(data.display_name || '')}</strong> <span class="small">@${esc(data.username)}${data.is_suspended ? ' · KISITLI' : ''}</span></div>
      <div style="margin-top:8px">${historyRows || '<div class="small">Ad değişikliği kaydı yok.</div>'}</div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn ghost small" href="#/user/${encodeURIComponent(data.id)}">Profili aç</a>
        <button class="btn ${data.is_suspended ? 'ghost' : 'danger'} small" id="adminSuspendBtn" type="button">${data.is_suspended ? 'Kısıtlamayı kaldır' : 'Hesabı kısıtla'}</button>
      </div><div class="message small" aria-live="polite"></div></div>`;
    document.getElementById('adminSuspendBtn')?.addEventListener('click', async () => {
      const action = data.is_suspended ? 'kısıtlamayı kaldırmak' : 'hesabı kısıtlamak';
      if (!confirm(`@${data.username} için ${action} istiyor musun?`)) return;
      const notes = prompt('İşlem notu (isteğe bağlı):', '') ?? null;
      if (notes === null) return;
      const { error: suspError } = await sb.rpc('admin_set_suspension', { target_user: data.id, suspend: !data.is_suspended, notes });
      const status = box.querySelector('.message');
      if (suspError) { status.textContent = `İşlem uygulanamadı: ${suspError.message}`; status.classList.add('error'); return; }
      status.textContent = 'İşlem uygulandı.';
      document.getElementById('adminUserSearchForm').requestSubmit();
    });
  });
  document.getElementById('grantBadgeForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const grantForm = e.currentTarget;
    const username = document.getElementById('grantBadgeUser').value.trim().replace(/^@+/, '').toLowerCase();
    const badgeName = document.getElementById('grantBadgeName').value.trim();
    const badgeDesc = document.getElementById('grantBadgeDesc').value.trim();
    const badgeIcon = document.getElementById('grantBadgeIcon').value.trim() || '✦';
    const message = document.getElementById('grantBadgeMessage');
    const button = e.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    const { error } = await sb.rpc('admin_grant_badge', { target_username: username, badge_name: badgeName, badge_desc: badgeDesc, badge_icon: badgeIcon });
    button.disabled = false;
    if (error) { message.textContent = `Rozet verilemedi: ${error.message}`; message.className = 'message error'; return; }
    message.textContent = `@${username} kullanıcısına "${badgeName}" rozeti verildi.`;
    message.className = 'message success';
    grantForm.reset();
    loadCustomBadgeList();
  });

  const loadThemeList = async () => {
    const list = document.getElementById('themeList');
    if (!list) return;
    const { data: rows, error } = await sb.from('weekly_themes').select('*').order('starts_on', { ascending: false }).limit(10);
    if (error) { list.innerHTML = `<div class="message error">${esc(error.message)}</div>`; return; }
    if (!rows?.length) { list.innerHTML = '<div class="empty">Henüz tema açılmadı.</div>'; return; }
    const ids = rows.map(t => t.id);
    const { data: counts } = await sb.from('posts').select('theme_id').in('theme_id', ids);
    const countMap = {};
    (counts || []).forEach(p => { countMap[p.theme_id] = (countMap[p.theme_id] || 0) + 1; });
    list.innerHTML = rows.map(t => `
      <div class="collection-item-row" style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)">
        <span><strong>${esc(t.title)}</strong> <span class="small">${esc(t.starts_on)} → ${esc(t.ends_on)} · ${countMap[t.id] || 0} eser</span></span>
        <button class="btn ghost small theme-toggle" data-id="${esc(t.id)}" data-active="${t.active}" type="button">${t.active ? 'Kapat' : 'Aç'}</button>
      </div>`).join('');
    list.querySelectorAll('.theme-toggle').forEach(btn => btn.addEventListener('click', async () => {
      btn.disabled = true;
      const { error } = await sb.from('weekly_themes').update({ active: btn.dataset.active !== 'true' }).eq('id', btn.dataset.id);
      if (error) alert('Tema güncellenemedi: ' + error.message);
      loadThemeList();
    }));
  };
  loadThemeList();
  document.getElementById('themeForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const title = document.getElementById('themeTitle').value.trim();
    const prompt = document.getElementById('themePrompt').value.trim();
    const starts_on = document.getElementById('themeStart').value;
    const ends_on = document.getElementById('themeEnd').value;
    const msg = document.getElementById('themeMessage');
    if (!starts_on || !ends_on || ends_on < starts_on) { msg.textContent = 'Bitiş tarihi başlangıçtan önce olamaz.'; msg.className = 'message error'; return; }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    const { error } = await sb.from('weekly_themes').insert({ title, prompt: prompt || null, starts_on, ends_on });
    btn.disabled = false;
    if (error) { msg.textContent = 'Tema açılamadı: ' + error.message; msg.className = 'message error'; return; }
    msg.textContent = `"${title}" teması açıldı.`; msg.className = 'message success';
    form.reset();
    loadThemeList();
  });

  const loadCustomBadgeList = async () => {
    const list = document.getElementById('customBadgeList');
    if (!list) return;
    const { data: badgeRows, error: listError } = await sb.from('custom_badges').select('*').order('created_at', { ascending: false });
    if (listError) { list.innerHTML = `<div class="message error">${esc(listError.message)}</div>`; return; }
    if (!badgeRows?.length) { list.innerHTML = '<div class="empty">Henüz özel rozet yok.</div>'; return; }
    const { data: holders } = await sb.from('user_badges').select('badge_key,user_id').in('badge_key', badgeRows.map(b => b.badge_key));
    const holderIds = [...new Set((holders || []).map(h => h.user_id))];
    const { data: holderProfiles } = holderIds.length
      ? await sb.from('profiles').select('id,username').in('id', holderIds) : { data: [] };
    const holderMap = Object.fromEntries((holderProfiles || []).map(p => [p.id, p.username]));
    list.innerHTML = badgeRows.map(b => {
      const who = (holders || []).filter(h => h.badge_key === b.badge_key).map(h => '@' + (holderMap[h.user_id] || '?')).join(', ');
      return `<div class="admin-badge-row" data-key="${esc(b.badge_key)}">
        <span class="admin-badge-icon">${esc(b.icon)}</span>
        <div style="flex:1"><strong>${esc(b.name)}</strong>
          ${b.description ? `<div class="small">${esc(b.description)}</div>` : ''}
          <div class="small">${who || 'Kimseye verilmemiş'}</div></div>
        <button class="btn ghost small" data-edit-badge="${esc(b.badge_key)}" type="button">Düzenle</button>
      </div>`;
    }).join('');
    list.querySelectorAll('[data-edit-badge]').forEach(btn => btn.addEventListener('click', () => {
      const b = badgeRows.find(x => x.badge_key === btn.dataset.editBadge);
      if (!b) return;
      document.getElementById('editBadgeKey').value = b.badge_key;
      document.getElementById('editBadgeName').value = b.name;
      document.getElementById('editBadgeDesc').value = b.description || '';
      document.getElementById('editBadgeIcon').value = b.icon || '✦';
      document.getElementById('editBadgeForm').hidden = false;
      document.getElementById('editBadgeName').focus();
    }));
  };
  loadCustomBadgeList();

  document.getElementById('editBadgeCancel')?.addEventListener('click', () => {
    document.getElementById('editBadgeForm').hidden = true;
  });
  document.getElementById('editBadgeForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const message = document.getElementById('editBadgeMessage');
    const { error } = await sb.rpc('admin_update_badge', {
      b_key: document.getElementById('editBadgeKey').value,
      badge_name: document.getElementById('editBadgeName').value.trim(),
      badge_desc: document.getElementById('editBadgeDesc').value.trim(),
      badge_icon: document.getElementById('editBadgeIcon').value.trim() || '✦'
    });
    if (error) { message.textContent = `Kaydedilemedi: ${error.message}`; message.className = 'message error'; return; }
    message.textContent = 'Rozet güncellendi.';
    message.className = 'message success';
    loadCustomBadgeList();
  });
  app.querySelectorAll('.admin-report [data-action]').forEach(button => button.addEventListener('click', async () => {
    const card = button.closest('.admin-report');
    const action = button.dataset.action;
    if (action === 'remove_content' && !confirm('Bu içeriği kalıcı olarak kaldırmak istediğine emin misin?')) return;
    if (action === 'suspend_user' && !confirm('Bu hesabın siteyi kullanmasını kısıtlamak istiyor musun?')) return;
    const notes = prompt('İşlem notu (isteğe bağlı):', '') ?? null;
    if (notes === null) return;
    const status = card.querySelector('.message');
    button.disabled = true;
    const { error } = await sb.rpc('admin_handle_report', { report_id: card.dataset.reportId, moderation_action: action, action_notes: notes.trim() });
    if (error) { status.textContent = `İşlem uygulanamadı: ${error.message}`; status.classList.add('error'); button.disabled = false; return; }
    await renderAdmin();
  }));
  app.querySelectorAll('.admin-flag [data-action]').forEach(button => button.addEventListener('click', async () => {
    const card = button.closest('.admin-flag');
    const action = button.dataset.action;
    if (action === 'remove_content' && !confirm('Bu içeriği kalıcı olarak kaldırmak istediğine emin misin?')) return;
    if (action === 'suspend_user' && !confirm('Bu hesabın siteyi kullanmasını kısıtlamak istiyor musun?')) return;
    const notes = prompt('İşlem notu (isteğe bağlı):', '') ?? null;
    if (notes === null) return;
    const status = card.querySelector('.message');
    button.disabled = true;
    const { error } = await sb.rpc('admin_handle_flag', { flag_id: card.dataset.flagId, moderation_action: action, action_notes: notes.trim() });
    if (error) { status.textContent = `İşlem uygulanamadı: ${error.message}`; status.classList.add('error'); button.disabled = false; return; }
    await renderAdmin();
  }));
  app.querySelectorAll('.admin-bug [data-action]').forEach(button => button.addEventListener('click', async () => {
    const card = button.closest('.admin-bug');
    const action = button.dataset.action;
    const notes = prompt('İşlem notu (isteğe bağlı):', '') ?? null;
    if (notes === null) return;
    const status = card.querySelector('.message');
    button.disabled = true;
    const { error } = await sb.rpc('admin_handle_bug_report', { bug_report_id: card.dataset.bugId, moderation_action: action, action_notes: notes.trim() });
    if (error) { status.textContent = `İşlem uygulanamadı: ${error.message}`; status.classList.add('error'); button.disabled = false; return; }
    await renderAdmin();
  }));
}

async function renderBugReport() {
  if (!currentUser) { location.hash = '#/auth?login'; return; }
  const { data: mine } = await sb.from('bug_reports').select('*').order('created_at', { ascending: false }).limit(20);
  const statusLabels = { open: 'İnceleniyor', resolved: 'Çözüldü', dismissed: 'Kapandı' };
  const mineCards = (mine || []).map(r => `<article class="card" style="margin:10px 0;padding:14px">
    <div class="meta"><strong>${esc(statusLabels[r.status] || r.status)}</strong><span>${esc(formatDate(r.created_at))}</span></div>
    <p class="small" style="margin:6px 0 0">${esc(String(r.description || '').slice(0, 300))}</p>
  </article>`).join('');
  app.innerHTML = `
    <section class="hero">
      <div class="eyebrow">Geri bildirim</div>
      <h1>Hata bildir</h1>
      <p class="subtitle">Karşılaştığın hatayı mümkünse ekran görüntüsüyle birlikte anlat; yönetim ekibi inceleyecek.</p>
    </section>
    <section class="card" style="max-width:640px">
      <form id="bugReportForm">
        <div class="field">
          <label for="bugDescription">Hatayı açıkla</label>
          <textarea id="bugDescription" required minlength="10" maxlength="2000" rows="6" placeholder="Ne yaparken hata oldu? Hangi sayfadaydın? Ne olması gerekirken ne oldu?"></textarea>
        </div>
        <div class="field">
          <label for="bugScreenshot">Ekran görüntüsü (isteğe bağlı, en fazla 5 MB)</label>
          <input id="bugScreenshot" type="file" accept="image/jpeg,image/png,image/webp">
        </div>
        <button class="btn primary" type="submit">Gönder</button>
        <div class="message" id="bugReportMessage" aria-live="polite"></div>
      </form>
    </section>
    <section style="margin-top:32px"><h2>Önceki bildirimlerim</h2>${mineCards || '<div class="empty">Henüz hata bildirimin yok.</div>'}</section>`;
  document.getElementById('bugReportForm').addEventListener('submit', async e => {
    e.preventDefault();
    const message = document.getElementById('bugReportMessage');
    const submitBtn = e.currentTarget.querySelector('button[type="submit"]');
    const description = document.getElementById('bugDescription').value.trim();
    const file = document.getElementById('bugScreenshot').files?.[0];
    message.classList.remove('error');
    if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) {
      message.classList.add('error');
      message.textContent = 'JPG, PNG veya WebP biçiminde ve 5 MB’tan küçük bir görsel seç.';
      return;
    }
    submitBtn.disabled = true;
    let screenshotPath = null;
    if (file) {
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
      screenshotPath = `${currentUser.id}/${crypto.randomUUID()}.${extension}`;
      message.textContent = 'Görüntü yükleniyor…';
      const { error: uploadError } = await sb.storage.from('bug-reports').upload(screenshotPath, file, { contentType: file.type, upsert: false });
      if (uploadError) {
        message.classList.add('error');
        message.textContent = `Görüntü yüklenemedi: ${uploadError.message}`;
        submitBtn.disabled = false;
        return;
      }
    }
    message.textContent = 'Bildirim gönderiliyor…';
    const { error } = await sb.rpc('submit_bug_report', { bug_description: description, bug_screenshot_path: screenshotPath });
    if (error) {
      if (screenshotPath) await sb.storage.from('bug-reports').remove([screenshotPath]);
      message.classList.add('error');
      message.textContent = `Bildirim gönderilemedi: ${error.message}`;
      submitBtn.disabled = false;
      return;
    }
    message.textContent = 'Bildirimin alındı, teşekkürler!';
    await renderBugReport();
  });
}

async function renderSettings() {
  if (!currentUser) { location.hash = '#/auth'; return; }
  await loadProfile();
  const profile = currentProfile || {};
  const createdAt = currentUser.created_at ? formatDate(currentUser.created_at) : '—';
  app.innerHTML = `
    <section class="hero">
      <div class="eyebrow">Hesabın</div>
      <h1>Hesap ayarları</h1>
      <p class="subtitle">Profil bilgilerini ve giriş yöntemlerini buradan yönetebilirsin.</p>
    </section>
    <div class="settings-grid">
      <section class="card settings-card settings-card-wide">
        <h2>Profil bilgileri</h2>
        <p class="small">Bu bilgiler profilinde ve eserlerinin yanında görünür.</p>
        <form id="settingsProfileForm">
          <div class="field">
            <label for="settingsDisplayName">Görünen ad</label>
            <input id="settingsDisplayName" name="display_name" required maxlength="60" value="${esc(profile.display_name || '')}">
          </div>
          <div class="field">
            <label for="settingsUsername">Kullanıcı adı</label>
            <input id="settingsUsername" name="username" required minlength="3" maxlength="20" pattern="[a-z0-9_]{3,20}" title="3-20 karakter: küçük harf, rakam ve alt çizgi" value="${esc(profile.username || '')}">
          </div>
          <div class="field">
            <label for="settingsBio">Hakkımda</label>
            <textarea id="settingsBio" name="bio" maxlength="500" placeholder="Kendinden kısaca bahset…">${esc(profile.bio || '')}</textarea>
          </div>
          <div class="field"><label for="settingsVisibility">Profil görüntüleme izni</label>
            <select id="settingsVisibility" name="profile_visibility"><option value="public" ${profile.profile_visibility !== 'private' ? 'selected' : ''}>Herkese açık</option><option value="private" ${profile.profile_visibility === 'private' ? 'selected' : ''}>Gizli — yalnızca ben ve sohbet ettiğim kişiler</option></select>
            <div class="small">Gizli profilin eserleri, yorumları ve görselleri diğer ziyaretçilere gösterilmez.</div>
          </div>
          <div class="field"><label for="settingsStatsVisibility">İstatistik görünürlüğü</label>
            <select id="settingsStatsVisibility" name="stats_visibility"><option value="public" ${profile.stats_visibility !== 'private' ? 'selected' : ''}>Herkese açık</option><option value="private" ${profile.stats_visibility === 'private' ? 'selected' : ''}>Yalnızca bana</option></select>
          </div>
          <div class="field"><label for="settingsAccent">Profil vurgu rengi</label>
            <input id="settingsAccent" name="profile_accent" type="color" value="${esc(profileAccent(profile))}" style="height:48px;padding:5px;max-width:120px">
          </div>
          <div class="field"><label for="settingsLayout">Profil düzeni</label>
            <select id="settingsLayout" name="profile_layout">
              <option value="standard" ${profile.profile_layout === 'standard' || !profile.profile_layout ? 'selected' : ''}>Klasik</option>
              <option value="compact" ${profile.profile_layout === 'compact' ? 'selected' : ''}>Sade ve kompakt</option>
              <option value="showcase" ${profile.profile_layout === 'showcase' ? 'selected' : ''}>Görsel odaklı</option>
            </select>
          </div>
          <button class="btn primary" type="submit">Profil bilgilerini kaydet</button>
          <div id="settingsProfileMessage" class="message" aria-live="polite"></div>
        </form>
      </section>

      <section class="card settings-card settings-card-wide">
        <h2>Profil görselleri</h2>
        <p class="small">JPG, PNG veya WebP; görsel başına en fazla 5 MB.</p>
        <div class="field"><label for="avatarUpload">Profil fotoğrafı</label><input id="avatarUpload" type="file" accept="image/jpeg,image/png,image/webp"></div>
        <div class="field"><label for="coverUpload">Kapak görseli</label><input id="coverUpload" type="file" accept="image/jpeg,image/png,image/webp"></div>
        <div id="settingsImagesMessage" class="message" aria-live="polite"></div>
      </section>

      <section class="card settings-card">
        <h2>E-posta adresi</h2>
        <div class="field">
          <label for="currentEmail">Kullanılan adres</label>
          <input id="currentEmail" type="email" value="${esc(currentUser.email || '')}" readonly>
        </div>
        <form id="settingsEmailForm">
          <div class="field">
            <label for="newEmail">Yeni e-posta adresi</label>
            <input id="newEmail" name="email" type="email" required autocomplete="email" placeholder="yeni@eposta.com">
          </div>
          <button class="btn primary" type="submit">E-posta değişikliğini başlat</button>
          <div id="settingsEmailMessage" class="message" aria-live="polite"></div>
        </form>
        <p class="small">Adres değişikliği için e-posta onayı istenebilir.</p>
      </section>

      <section class="card settings-card">
        <h2>Şifre</h2>
        <p class="small">Yeni bir şifre belirle. 12–72 karakter kullan; harf, rakam ve sembol ekle.</p>
        <form id="settingsPasswordForm">
          <div class="field">
            <label for="newPassword">Yeni şifre</label>
            <input id="newPassword" name="password" type="password" required minlength="12" maxlength="72" autocomplete="new-password">
          </div>
          <div class="field">
            <label for="confirmPassword">Yeni şifreyi tekrar yaz</label>
            <input id="confirmPassword" name="confirm_password" type="password" required minlength="12" maxlength="72" autocomplete="new-password">
          </div>
          <button class="btn primary" type="submit">Şifreyi güncelle</button>
          <div id="settingsPasswordMessage" class="message" aria-live="polite"></div>
        </form>
      </section>

      <section class="card settings-card settings-card-wide">
        <h2>İki adımlı doğrulama</h2>
        <p class="small">Bir doğrulama uygulamasıyla girişini ek bir kodla koru. Kurulumdan sonra bu hesapta MFA ile giriş doğrulanır.</p>
        <div id="mfaManager">${loadingBlock('Güvenlik ayarları yükleniyor…')}</div>
      </section>

      <section class="card settings-card">
        <h2>Hesap bilgisi</h2>
        <p class="small">Hesap oluşturma tarihi: ${esc(createdAt)}</p>
        <p class="small">Yeni kullanıcı kayıtları ve e-posta doğrulaması açık.</p>
        <button class="btn danger" id="settingsLogoutBtn" type="button">Bu cihazdan çıkış yap</button>
        <button class="btn danger" id="settingsDeleteAccountBtn" type="button" style="margin-top:8px">Hesabı kalıcı olarak sil</button>
        <div id="settingsAccountMessage" class="message" aria-live="polite"></div>
      </section>

      <section class="card settings-card settings-card-wide">
        <h2>Bağlı hesaplar</h2>
        <p class="small">Aynı HALKA hesabına farklı giriş yöntemlerini bağlayabilir veya bağlantısını kesebilirsin.</p>
        <div id="linkedAccountsList">${loadingBlock('Bağlı hesaplar yükleniyor…')}</div>
        <div id="linkAccountTitle" style="margin-top:12px"><strong>Yeni hesap bağla:</strong></div>
        <div class="oauth-grid" id="linkAccountGrid" style="display:grid;gap:8px;margin-top:8px">
          ${ENABLED_OAUTH_PROVIDERS.map(p => `<button class="btn ghost link-account-btn" data-provider="${p}" type="button">${OAUTH_PROVIDER_NAMES[p]} bağla</button>`).join('')}
        </div>
      </section>

      <section class="card settings-card settings-card-wide" id="friendRequestsCard">
        <h2>Arkadaşlık istekleri</h2>
        <p class="small" id="friendRequestsLoading">Yükleniyor…</p>
        <div id="friendRequestsList"></div>
      </section>
    </div>
  `;

  document.getElementById('settingsProfileForm').addEventListener('submit', async e => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const display_name = String(form.get('display_name') || '').trim();
    const username = String(form.get('username') || '').trim().toLowerCase();
    const bio = String(form.get('bio') || '').trim();
    const profile_visibility = String(form.get('profile_visibility') || 'public');
    const stats_visibility = String(form.get('stats_visibility') || 'public');
    const profile_accent = String(form.get('profile_accent') || '#d9b978');
    const profile_layout = String(form.get('profile_layout') || 'standard');
    const message = document.getElementById('settingsProfileMessage');
    const button = e.currentTarget.querySelector('button[type="submit"]');
    if (!display_name) return setSettingsMessage(message, 'Görünen ad boş bırakılamaz.', true);
    if (!/^[a-z0-9_]{3,20}$/.test(username)) return setSettingsMessage(message, 'Kullanıcı adı 3–20 karakter olmalı; küçük harf, rakam ve alt çizgi kullan.', true);
    if (!/^#[0-9a-f]{6}$/i.test(profile_accent)) return setSettingsMessage(message, 'Profil rengi geçerli değil.', true);
    if (!['standard', 'compact', 'showcase'].includes(profile_layout)) return setSettingsMessage(message, 'Profil düzeni geçerli değil.', true);
    button.disabled = true;
    let { error } = await sb.from('profiles').update({ username, display_name, bio, profile_visibility, stats_visibility, profile_accent, profile_layout }).eq('id', currentUser.id);
    let migrationPending = false;
    if (error && /profile_accent|profile_layout|profile_visibility|stats_visibility|schema cache/i.test(error.message || '')) {
      const fallback = await sb.from('profiles').update({ username, display_name, bio }).eq('id', currentUser.id);
      error = fallback.error;
      migrationPending = !error;
    }
    button.disabled = false;
    if (error) return setSettingsMessage(message, `Profil kaydedilemedi: ${error.message}`, true);
    await loadProfile();
    setSettingsMessage(message, migrationPending
      ? 'Temel profil bilgilerin kaydedildi. Görünüm ve gizlilik tercihleri için Supabase veritabanı güncellemesini uygulaman gerekiyor.'
      : 'Profil bilgileri kaydedildi.');
  });

  for (const [inputId, column] of [['avatarUpload', 'avatar_path'], ['coverUpload', 'cover_path']]) {
    document.getElementById(inputId).addEventListener('change', async e => {
      const input = e.currentTarget;
      let file = input.files?.[0];
      if (!file) return;
      const message = document.getElementById('settingsImagesMessage');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
        return setSettingsMessage(message, 'JPG, PNG veya WebP biçiminde ve 5 MB’tan küçük bir görsel seç.', true);
      }
      file = await compressImage(file, inputId === 'avatarUpload' ? 800 : 1600);
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
      const path = `${currentUser.id}/${crypto.randomUUID()}.${extension}`;
      input.disabled = true;
      setSettingsMessage(message, 'Görsel yükleniyor…');
      const { error: uploadError } = await sb.storage.from('profile-images').upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) { input.disabled = false; return setSettingsMessage(message, `Görsel yüklenemedi: ${uploadError.message}`, true); }
      const oldPath = currentProfile?.[column];
      const { error: updateError } = await sb.from('profiles').update({ [column]: path }).eq('id', currentUser.id);
      if (updateError) {
        await sb.storage.from('profile-images').remove([path]);
        input.disabled = false;
        return setSettingsMessage(message, `Profil görseli kaydedilemedi: ${updateError.message}`, true);
      }
      if (oldPath) await sb.storage.from('profile-images').remove([oldPath]);
      await loadProfile();
      input.disabled = false;
      input.value = '';
      setSettingsMessage(message, 'Profil görseli güncellendi.');
    });
  }

  document.getElementById('settingsEmailForm').addEventListener('submit', async e => {
    e.preventDefault();
    const emailForm = e.currentTarget;
    const email = String(new FormData(emailForm).get('email') || '').trim();
    const message = document.getElementById('settingsEmailMessage');
    const button = e.currentTarget.querySelector('button[type="submit"]');
    if (email.toLowerCase() === String(currentUser.email || '').toLowerCase()) return setSettingsMessage(message, 'Bu zaten hesabında kullanılan e-posta adresi.', true);
    button.disabled = true;
    const { error } = await sb.auth.updateUser({ email });
    button.disabled = false;
    if (error) return setSettingsMessage(message, `E-posta değiştirilemedi: ${error.message}`, true);
    emailForm.reset();
    setSettingsMessage(message, 'E-posta değişikliği başlatıldı. Onay iletilerini gelen kutularında kontrol et.');
  });

  document.getElementById('settingsPasswordForm').addEventListener('submit', async e => {
    e.preventDefault();
    const passwordForm = e.currentTarget;
    const form = new FormData(passwordForm);
    const password = String(form.get('password') || '');
    const confirmation = String(form.get('confirm_password') || '');
    const message = document.getElementById('settingsPasswordMessage');
    const button = e.currentTarget.querySelector('button[type="submit"]');
    if (password.length < 12) return setSettingsMessage(message, 'Şifre en az 12 karakter olmalı.', true);
    if (new TextEncoder().encode(password).length > 72) return setSettingsMessage(message, 'Şifre en fazla 72 bayt olabilir. Daha kısa bir şifre seç.', true);
    if (!/[a-z]/i.test(password) || !/\d/.test(password) || !/[^a-z0-9]/i.test(password)) return setSettingsMessage(message, 'Şifrede en az bir harf, bir rakam ve bir sembol kullan.', true);
    if (password !== confirmation) return setSettingsMessage(message, 'Şifreler eşleşmiyor.', true);
    button.disabled = true;
    const { error } = await sb.auth.updateUser({ password });
    button.disabled = false;
    if (error) return setSettingsMessage(message, `Şifre güncellenemedi: ${error.message}`, true);
    passwordForm.reset();
    setSettingsMessage(message, 'Şifren güncellendi.');
  });

  await renderMfaManager();

  const refreshFriendRequests = async () => {
    const list = document.getElementById('friendRequestsList');
    const loading = document.getElementById('friendRequestsLoading');
    if (!list) return;
    const { data, error } = await sb.from('friend_requests').select('id,sender_id,status').eq('receiver_id', currentUser.id).eq('status', 'pending');
    loading.style.display = 'none';
    if (error) { list.innerHTML = `<p class="small message error">İstekler yüklenemedi: ${esc(error.message)}</p>`; return; }
    if (!data?.length) { list.innerHTML = '<p class="small">Bekleyen arkadaşlık isteği yok.</p>'; return; }
    const senderIds = data.map(req => req.sender_id);
    const profilesResult = await sb.from('profiles').select('id,username,display_name').in('id', senderIds);
    const senderMap = Object.fromEntries((profilesResult.data || []).map(p => [p.id, p]));
    list.innerHTML = `<div class="chat-list">${data.map(req => {
      const sender = senderMap[req.sender_id];
      return `<div class="chat-item" style="align-items:center;gap:10px">
        <div class="avatar">${initials(displayName(sender))}</div>
        <div style="flex:1;min-width:0"><div class="chat-item-title">${esc(displayName(sender, 'Bir kullanıcı'))}</div><div class="small">@${esc(sender?.username || '')}</div></div>
        <div style="display:flex;gap:6px">
          <button class="btn primary small" data-request="${esc(req.id)}" data-action="accept" type="button">Kabul et</button>
          <button class="btn small" data-request="${esc(req.id)}" data-action="reject" type="button">Reddet</button>
        </div>
      </div>`;
    }).join('')}</div>`;
    list.querySelectorAll('button[data-request]').forEach(btn => btn.addEventListener('click', async () => {
      const status = btn.dataset.action === 'accept' ? 'accepted' : 'rejected';
      const { error: updateError } = await sb.from('friend_requests').update({ status, updated_at: new Date().toISOString() }).eq('id', btn.dataset.request);
      if (updateError) { alert('İşlem başarısız: ' + updateError.message); return; }
      await refreshFriendRequests();
    }));
  };
  refreshFriendRequests();

  const refreshLinkedAccounts = async () => {
    const list = document.getElementById('linkedAccountsList');
    const { data: userData } = await sb.auth.getUser();
    if (userData?.user) currentUser = userData.user;
    const identities = currentUser?.identities || [];
    const linkedProviders = new Set(identities.map(id => id.provider));
    const providerNames = { email: 'E-posta', phone: 'Telefon', google: 'Google', facebook: 'Facebook', twitter: 'X', apple: 'Apple', github: 'GitHub', discord: 'Discord' };
    list.innerHTML = identities.length ? `<div class="chat-list">${identities.map(id => `<div class="chat-item" style="align-items:center;gap:10px"><div style="flex:1"><div class="chat-item-title">${esc(providerNames[id.provider] || id.provider)}</div><div class="small">${esc(id.identity_data?.email || id.identity_data?.phone || id.provider)}</div></div>${identities.length > 1 ? `<button class="btn small" data-unlink="${esc(id.identity_id)}" type="button">Bağlantıyı kes</button>` : ''}</div>`).join('')}</div>` : '<p class="small">Bağlı hesap yok.</p>';
    list.querySelectorAll('button[data-unlink]').forEach(btn => btn.addEventListener('click', async () => {
      const identity = identities.find(i => i.identity_id === btn.dataset.unlink);
      if (!identity) return;
      const { error } = await sb.auth.unlinkIdentity(identity);
      if (error) { alert('Bağlantı kesilemedi: ' + error.message); return; }
      await loadProfile();
      refreshLinkedAccounts();
    }));
    let visibleCount = 0;
    document.querySelectorAll('.link-account-btn').forEach(btn => {
      const alreadyLinked = linkedProviders.has(btn.dataset.provider);
      btn.style.display = alreadyLinked ? 'none' : '';
      if (!alreadyLinked) visibleCount += 1;
    });
    const linkTitle = document.getElementById('linkAccountTitle');
    const linkGrid = document.getElementById('linkAccountGrid');
    if (linkTitle) linkTitle.style.display = visibleCount ? '' : 'none';
    if (linkGrid) linkGrid.style.display = visibleCount ? 'grid' : 'none';
  };
  refreshLinkedAccounts();

  document.querySelectorAll('.link-account-btn').forEach(btn => btn.addEventListener('click', async () => {
    const redirectTo = `${window.location.origin}${window.location.pathname}#/settings`;
    const { data, error } = await sb.auth.linkIdentity({ provider: btn.dataset.provider, options: { redirectTo } });
    if (error) { alert('Hesap bağlama başlatılamadı: ' + error.message); return; }
    if (data?.url) window.location.assign(data.url);
  }));

  document.getElementById('settingsLogoutBtn').addEventListener('click', async () => {
    const message = document.getElementById('settingsAccountMessage');
    const { error } = await sb.auth.signOut();
    if (error) return setSettingsMessage(message, `Çıkış yapılamadı: ${error.message}`, true);
    currentUser = null;
    location.hash = '#/';
  });

  document.getElementById('settingsDeleteAccountBtn').addEventListener('click', async () => {
    const message = document.getElementById('settingsAccountMessage');
    if (!confirm('Hesabını kalıcı olarak silmek istediğine emin misin? Tüm eserlerin, yorumların, beğenilerin ve sohbetlerin silinecek.')) return;
    if (prompt('Onaylamak için büyük harflerle SİL yaz:') !== 'SİL') return;
    const { error } = await sb.rpc('delete_own_account');
    if (error) return setSettingsMessage(message, `Hesap silinemedi: ${error.message}`, true);
    try { await sb.auth.signOut(); } catch {}
    currentUser = null;
    currentProfile = null;
    location.hash = '#/';
    alert('Hesabın silindi.');
  });
}

async function renderNotifications() {
  if (!currentUser) { location.hash = '#/auth?login'; return; }
  app.innerHTML = loadingBlock('Bildirimler yükleniyor…');
  const { data: rows, error } = await sb.from('notifications')
    .select('*').eq('user_id', currentUser.id)
    .order('created_at', { ascending: false }).limit(60);
  if (error) {
    app.innerHTML = `<div class="empty">Bildirimler yüklenemedi.<br><span class="small">${esc(error.message)}</span></div>`;
    return;
  }
  const list = rows || [];
  const actorIds = [...new Set(list.map(r => r.actor_id).filter(Boolean))];
  const postIds = [...new Set(list.map(r => r.post_id).filter(Boolean))];
  const [profRes, postRes] = await Promise.all([
    actorIds.length ? sb.from('profiles').select('id,username,display_name').in('id', actorIds) : Promise.resolve({ data: [] }),
    postIds.length ? sb.from('posts').select('id,title').in('id', postIds) : Promise.resolve({ data: [] })
  ]);
  const actors = Object.fromEntries((profRes.data || []).map(p => [p.id, p]));
  const posts = Object.fromEntries((postRes.data || []).map(p => [p.id, p]));
  const badgeKeys = list.filter(n => n.type === 'badge' && n.badge_key).map(n => n.badge_key);
  const { data: customBadgeRows } = badgeKeys.length
    ? await sb.from('custom_badges').select('badge_key,name,description,icon').in('badge_key', badgeKeys)
    : { data: [] };
  const customBadgeDefs = (customBadgeRows || []).map(b => ({ key: b.badge_key, name: b.name, desc: b.description, icon: b.icon }));

  const texts = {
    like: 'eserini beğendi',
    comment: 'eserine yorum yaptı',
    reply: 'yorumuna yanıt verdi',
    friend_request: 'sana arkadaşlık isteği gönderdi',
    friend_accept: 'arkadaşlık isteğini kabul etti',
    message: 'sana mesaj gönderdi',
    follow: 'seni takip etmeye başladı',
    new_post: 'yeni bir eser paylaştı',
    relay: 'nöbetleşe hikâyede seni bekliyor'
  };
  const targetFor = n => {
    if (n.type === 'badge') return '#/profile';
    if (n.relay_id) return `#/relay/${encodeURIComponent(n.relay_id)}`;
    if (n.post_id) return `#/read/${encodeURIComponent(n.post_id)}`;
    if (n.type === 'friend_request') return '#/settings';
    if ((n.type === 'friend_accept' || n.type === 'follow') && n.actor_id) return `#/user/${encodeURIComponent(n.actor_id)}`;
    if (n.conversation_id) return `#/chat/${encodeURIComponent(n.conversation_id)}`;
    return '#/notifications';
  };

  const unreadCount = list.filter(n => !n.read_at).length;
  app.innerHTML = `
    <section class="card settings-card settings-card-wide" style="max-width:720px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <h2 style="margin:0">Bildirimler</h2>
        ${unreadCount ? `<button class="btn small" id="markAllReadBtn" type="button">Tümünü okundu işaretle (${unreadCount})</button>` : ''}
      </div>
      <div class="chat-list" id="notifList" style="margin-top:12px">
        ${list.length ? list.map(n => {
          const actor = actors[n.actor_id];
          const name = actor ? displayName(actor) : 'Bir kullanıcı';
          const postTitle = n.post_id && posts[n.post_id]?.title ? ` — “${esc(posts[n.post_id].title)}”` : '';
          const time = new Date(n.created_at).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
          return `<div class="chat-item notif-item${n.read_at ? '' : ' unread'}" data-id="${esc(n.id)}" data-href="${esc(targetFor(n))}" role="button" tabindex="0">
            <div style="flex:1">
              <div class="chat-item-title">${n.type === 'badge' ? `🎖️ Yeni rozet kazandın: <strong>${esc(resolveBadge(n.badge_key, customBadgeDefs).name)}</strong>` : `<strong>${esc(name)}</strong> ${esc(texts[n.type] || n.type)}${postTitle}`}</div>
              <div class="small">${esc(time)}</div>
            </div>
            ${n.read_at ? '' : '<span class="notif-dot" aria-label="Okunmadı"></span>'}
          </div>`;
        }).join('') : '<p class="small">Henüz bildirimin yok.</p>'}
      </div>
    </section>
  `;

  const markRead = async ids => {
    if (!ids.length) return;
    await sb.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids);
  };
  document.getElementById('markAllReadBtn')?.addEventListener('click', async () => {
    await markRead(list.filter(n => !n.read_at).map(n => n.id));
    renderNotifications();
  });
  document.getElementById('notifList').querySelectorAll('.notif-item').forEach(el => {
    const open = async () => {
      const n = list.find(r => r.id === el.dataset.id);
      if (n && !n.read_at) markRead([n.id]);
      location.hash = el.dataset.href;
    };
    el.addEventListener('click', open);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
}

async function renderChat(conversationId, query = '') {
  clearInterval(chatRefreshTimer);
  chatRefreshTimer = null;
  if (!currentUser) { location.hash = '#/auth?login'; return; }
  const params = new URLSearchParams(query);
  const sharePostId = params.get('share') || '';
  const withUsername = (params.get('with') || '').replace(/^@/, '').trim().toLowerCase();
  const routeAtStart = location.hash;
  app.innerHTML = loadingBlock('Sohbetler yükleniyor…');

  const { data: ownMemberships, error: membershipError } = await sb.from('conversation_members')
    .select('conversation_id').eq('user_id', currentUser.id);
  if (membershipError) {
    app.innerHTML = `<div class="empty">Sohbet veritabanı henüz hazır değil.<br><span class="small">${esc(membershipError.message)}</span></div>`;
    return;
  }
  const conversationIds = [...new Set((ownMemberships || []).map(x => x.conversation_id))];
  const convResult = conversationIds.length
    ? await sb.from('conversations').select('*').in('id', conversationIds).order('created_at', { ascending: false })
    : { data: [], error: null };
  if (convResult.error) {
    app.innerHTML = `<div class="empty">Sohbetler yüklenemedi.<br><span class="small">${esc(convResult.error.message)}</span></div>`;
    return;
  }
  const conversations = convResult.data || [];
  const allMembersResult = conversationIds.length
    ? await sb.from('conversation_members').select('conversation_id,user_id').in('conversation_id', conversationIds)
    : { data: [], error: null };
  const allMembers = allMembersResult.data || [];
  const participantIds = [...new Set(allMembers.map(x => x.user_id))];
  const participantResult = participantIds.length
    ? await sb.from('profiles').select('id,username,display_name,last_active_at').in('id', participantIds)
    : { data: [], error: null };
  const participantProfiles = Object.fromEntries((participantResult.data || []).map(p => [p.id, p]));
  const lastActiveMap = Object.fromEntries((participantResult.data || []).filter(p => p.last_active_at).map(p => [p.id, p.last_active_at]));
  const memberMap = new Map();
  allMembers.forEach(m => {
    if (!memberMap.has(m.conversation_id)) memberMap.set(m.conversation_id, []);
    memberMap.get(m.conversation_id).push(m.user_id);
  });
  const conversationTitle = conv => {
    if (conv.is_group && conv.title) return conv.title;
    const names = (memberMap.get(conv.id) || []).filter(uid => uid !== currentUser.id)
      .map(uid => displayName(participantProfiles[uid], 'Halka kullanıcısı'));
    return conv.is_group ? names.join(', ') || 'Grup sohbeti' : names[0] || 'Yeni sohbet';
  };
  const activeId = conversationId || (sharePostId ? '' : conversations[0]?.id || '');
  const activeConversation = conversations.find(c => c.id === activeId);
  let sharedPost = null;
  let sharedPostError = null;
  if (sharePostId) {
    const result = await sb.from('posts').select('*').eq('id', sharePostId).maybeSingle();
    sharedPost = result.data;
    sharedPostError = result.error;
    if (sharedPost) await signPostMedia([sharedPost]);
  }
  if (location.hash !== routeAtStart) return;

  let latestMessages = conversationIds.length
    ? await sb.from('messages').select('conversation_id,body,shared_post_id,attachment_name,created_at').in('conversation_id', conversationIds).order('created_at', { ascending: false }).limit(100)
    : { data: [], error: null };
  if (latestMessages.error && /attachment_name|schema cache/i.test(latestMessages.error.message || '')) {
    latestMessages = await sb.from('messages').select('conversation_id,body,shared_post_id,created_at').in('conversation_id', conversationIds).order('created_at', { ascending: false }).limit(100);
  }
  const latestMap = {};
  (latestMessages.data || []).forEach(m => { if (!latestMap[m.conversation_id]) latestMap[m.conversation_id] = m; });
  const linkForConversation = c => `#/chat/${encodeURIComponent(c.id)}${sharePostId ? `?share=${encodeURIComponent(sharePostId)}` : ''}`;
  app.innerHTML = `
    <section class="hero" style="padding:0 0 16px"><div class="eyebrow">HALKA</div><h1 style="font-size:38px">Sohbetler</h1><p class="subtitle">Birine yaz, grup kur veya keşfettiğin bir eseri paylaş.</p></section>
    ${sharePostId && !sharedPost ? `<div class="message error">Paylaşılacak eser bulunamadı.${sharedPostError ? ` ${esc(sharedPostError.message)}` : ''}</div>` : ''}
    <div class="chat-layout">
      <aside class="chat-sidebar">
        <h2 style="margin:2px 0 8px;font-size:20px">Yeni sohbet</h2>
        <form id="newChatForm">
          <div class="field"><label for="chatUsernames">Kullanıcı adı</label><input id="chatUsernames" name="usernames" required value="${esc(withUsername)}" placeholder="ornek_kullanici, arkadas"></div>
          <div class="field"><label for="chatGroupTitle">Grup adı (isteğe bağlı)</label><input id="chatGroupTitle" name="title" maxlength="80" placeholder="Örn. Okuma grubu"></div>
          <button class="btn primary" type="submit">Sohbet başlat</button>
          <div id="chatCreateMessage" class="message" aria-live="polite"></div>
        </form>
        <hr><h2 style="font-size:20px;margin-bottom:6px">Sohbet listem</h2>
        <div class="chat-list">${conversations.length ? conversations.map(c => {
          const last = latestMap[c.id];
          return `<a class="chat-item ${c.id === activeId ? 'active' : ''}" href="${linkForConversation(c)}"><div class="chat-item-title">${esc(conversationTitle(c))}</div><div class="small">${esc(last?.body || (last?.shared_post_id ? 'Bir eser paylaşıldı' : last?.attachment_name ? `Dosya: ${last.attachment_name}` : 'Henüz mesaj yok'))}</div></a>`;
        }).join('') : '<div class="small">Henüz sohbetin yok. Kullanıcı adı yazarak başlayabilirsin.</div>'}</div>
      </aside>
      <section class="chat-panel">
        ${activeConversation ? `
          <div class="chat-heading">
            <div style="flex:1;min-width:0"><h2>${esc(activeConversation.custom_title || conversationTitle(activeConversation))}</h2><div class="small" id="chatHeadingMeta">${activeConversation.is_group ? 'Grup sohbeti' : 'Bire bir sohbet'}</div></div>
            <button class="btn ghost small" id="chatCustomizeBtn" type="button" aria-label="Sohbeti özelleştir">Özelleştir</button>
          </div>
          <div id="chatCustomizePanel" hidden>
            <form id="chatCustomizeForm" class="chat-compose" style="border-bottom:1px solid var(--line);padding:10px 14px">
              <div class="field" style="flex:1;margin:0"><label for="chatCustomTitle">Sohbet başlığı</label><input id="chatCustomTitle" name="custom_title" maxlength="80" value="${esc(activeConversation.custom_title || '')}" placeholder="Örn. Okuma grubu"></div>
              <div class="field" style="flex:0 0 80px;margin:0"><label for="chatThemeColor">Renk</label><input id="chatThemeColor" name="theme_color" type="color" value="${esc(activeConversation.theme_color || '#d9b978')}" style="height:38px;padding:4px"></div>
              <button class="btn primary" type="submit" style="align-self:flex-end">Kaydet</button>
              <button class="btn ghost" id="chatCustomizeClose" type="button" style="align-self:flex-end">Kapat</button>
            </form>
          </div>
          <div id="chatMessages" class="chat-messages" aria-live="polite" style="--chat-accent:${safeHex(activeConversation.theme_color)}">${loadingBlock('Mesajlar yükleniyor…')}</div>
          ${sharedPost ? `<div id="chatSharePreview" class="chat-share-preview"><div class="small">Bu eser mesajına eklenecek:</div>${chatPostPreview(sharedPost)}</div>` : '<div id="chatSharePreview" class="chat-share-preview"></div>'}
          <form id="chatComposeForm" class="chat-compose">
            <textarea id="chatMessageBody" maxlength="4000" aria-label="Mesajın" placeholder="Mesajını yaz…"></textarea>
            <div class="chat-attachment-picker"><label class="btn ghost small" for="chatAttachment">Fotoğraf, video veya PDF ekle</label><input id="chatAttachment" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,application/pdf" hidden><span id="chatAttachmentName" class="small">En fazla 25 MB</span></div>
            <button class="btn primary" type="submit">${sharedPost ? 'Eseri gönder' : 'Gönder'}</button>
          </form>
          <div id="chatSendMessage" class="message" style="padding:0 14px 8px" aria-live="polite"></div>
        ` : `<div style="margin:auto 16px;width:calc(100% - 32px)"><div class="empty">${sharePostId && sharedPost ? 'Bu eseri paylaşmak için soldaki listeden bir sohbet seç veya yeni bir sohbet başlat.' : 'Bir sohbet seç veya kullanıcı adıyla yeni bir sohbet başlat.'}</div>${sharePostId && sharedPost ? `<div class="chat-share-preview"><div class="small">Paylaşılacak eser:</div>${chatPostPreview(sharedPost)}</div>` : ''}</div>`}
      </section>
    </div>`;

  document.getElementById('newChatForm').addEventListener('submit', async e => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const usernames = [...new Set(String(data.get('usernames') || '').split(',').map(v => v.trim().replace(/^@/, '').toLowerCase()).filter(Boolean))];
    const title = String(data.get('title') || '').trim();
    const message = document.getElementById('chatCreateMessage');
    const button = e.currentTarget.querySelector('button[type="submit"]');
    if (!usernames.length) return setSettingsMessage(message, 'En az bir kullanıcı adı yaz.', true);
    if (usernames.length > 19) return setSettingsMessage(message, 'Bir sohbete en fazla 19 kişi ekleyebilirsin.', true);
    button.disabled = true;
    const { data: found, error } = await sb.from('profiles').select('id,username').in('username', usernames);
    if (error) { button.disabled = false; return setSettingsMessage(message, `Kullanıcılar aranamadı: ${error.message}`, true); }
    const recipients = (found || []).filter(p => p.id !== currentUser.id);
    const foundNames = new Set((found || []).map(p => p.username));
    const missing = usernames.filter(name => !foundNames.has(name));
    if (missing.length) { button.disabled = false; return setSettingsMessage(message, `Bulunamayan kullanıcı adı: ${missing.join(', ')}`, true); }
    if (!recipients.length) { button.disabled = false; return setSettingsMessage(message, 'Kendinle sohbet başlatamazsın.', true); }

    let existingId = '';
    if (recipients.length === 1 && !title) {
      const existing = conversations.find(c => !c.is_group && (memberMap.get(c.id) || []).length === 2 && (memberMap.get(c.id) || []).includes(recipients[0].id));
      existingId = existing?.id || '';
    }
    let newId = existingId;
    if (!newId) {
      const blockCheck = await sb.rpc('is_blocked', { checker: currentUser.id, target: recipients[0]?.id });
    if (blockCheck?.data) { button.disabled = false; return setSettingsMessage(message, 'Bu kullanıcıyı veya seni engellemiş bir kullanıcıya mesaj gönderemezsin.', true); }
    const result = await sb.rpc('create_conversation', {
        target_members: recipients.map(p => p.id), conversation_title: title || null
      });
      if (result.error) { button.disabled = false; return setSettingsMessage(message, `Sohbet açılamadı: ${result.error.message}`, true); }
      newId = result.data;
    }
    location.hash = `#/chat/${encodeURIComponent(newId)}${sharePostId ? `?share=${encodeURIComponent(sharePostId)}` : ''}`;
  });

  if (!activeConversation) return;
  const otherIds = (memberMap.get(activeId) || []).filter(uid => uid !== currentUser.id);
  const lastActiveTs = otherIds.length === 1 ? lastActiveMap[otherIds[0]] : null;
  if (lastActiveTs) {
    const meta = document.getElementById('chatHeadingMeta');
    if (meta) {
      const online = Date.now() - new Date(lastActiveTs).getTime() < 5 * 60 * 1000;
      meta.textContent = online ? 'Çevrimiçi' : `Son görülme: ${new Date(lastActiveTs).toLocaleString('tr-TR', { dateStyle:'short', timeStyle:'short' })}`;
      meta.classList.toggle('online', online);
    }
  }

  document.getElementById('chatCustomizeBtn')?.addEventListener('click', () => { document.getElementById('chatCustomizePanel').hidden = false; });
  document.getElementById('chatCustomizeClose')?.addEventListener('click', () => { document.getElementById('chatCustomizePanel').hidden = true; });
  document.getElementById('chatCustomizeForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const custom_title = String(fd.get('custom_title') || '').trim() || null;
    const theme_color = String(fd.get('theme_color') || '').trim() || null;
    const { error } = await sb.from('conversations').update({ custom_title, theme_color }).eq('id', activeId);
    const messageEl = document.getElementById('chatSendMessage');
    if (error) { setSettingsMessage(messageEl, `Özelleştirme kaydedilemedi: ${error.message}`, true); return; }
    setSettingsMessage(messageEl, 'Sohbet ayarları kaydedildi.');
    location.hash = `#/chat/${encodeURIComponent(activeId)}${sharePostId ? `?share=${encodeURIComponent(sharePostId)}` : ''}`;
  });

  const markRead = async () => {
    const unreadResult = await sb.from('messages').select('id').eq('conversation_id', activeId).is('read_at', null).neq('sender_id', currentUser.id).limit(100);
    const unreadIds = (unreadResult.data || []).map(m => m.id);
    if (unreadIds.length) {
      await sb.from('messages').update({ read_at: new Date().toISOString() }).in('id', unreadIds);
    }
    const undeliveredResult = await sb.from('messages').select('id').eq('conversation_id', activeId).is('delivered_at', null).neq('sender_id', currentUser.id).limit(100);
    const undeliveredIds = (undeliveredResult.data || []).map(m => m.id);
    if (undeliveredIds.length) {
      await sb.from('messages').update({ delivered_at: new Date().toISOString() }).in('id', undeliveredIds);
    }
  };

  const loadMessages = async (scrollIfNearBottom = false) => {
    if (!document.getElementById('chatMessages') || !location.hash.includes(encodeURIComponent(activeId))) return;
    const box = document.getElementById('chatMessages');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 100;
    let result = await sb.from('messages').select('id,conversation_id,sender_id,body,shared_post_id,attachment_path,attachment_mime,attachment_name,created_at,delivered_at,read_at,edited_at,deleted_at')
      .eq('conversation_id', activeId).order('created_at', { ascending: true }).limit(150);
    if (result.error && /delivered_at|read_at|edited_at|deleted_at|schema cache|does not exist/i.test(result.error.message || '')) {
      result = await sb.from('messages').select('id,conversation_id,sender_id,body,shared_post_id,attachment_path,attachment_mime,attachment_name,created_at')
        .eq('conversation_id', activeId).order('created_at', { ascending: true }).limit(150);
    }
    if (result.error) { box.innerHTML = `<div class="small">Mesajlar yüklenemedi: ${esc(result.error.message)}</div>`; return; }
    const rows = result.data || [];
    const senderIds = [...new Set(rows.map(row => row.sender_id))];
    const sendersResult = senderIds.length ? await sb.from('profiles').select('id,username,display_name').in('id', senderIds) : { data: [] };
    const senders = Object.fromEntries((sendersResult.data || []).map(p => [p.id, p]));
    const postIds = [...new Set(rows.map(row => row.shared_post_id).filter(Boolean))];
    const postsResult = postIds.length ? await sb.from('posts').select('*').in('id', postIds) : { data: [] };
    const sharedPosts = await attachBookCovers(postsResult.data || []);
    await signPostMedia(sharedPosts);
    const posts = Object.fromEntries(sharedPosts.map(p => [p.id, p]));
    const attachmentPaths = rows.filter(row => row.attachment_path).map(row => row.attachment_path);
    const signedAttachments = attachmentPaths.length ? await sb.storage.from('chat-media').createSignedUrls(attachmentPaths, 3600) : { data: [] };
    const attachmentUrls = Object.fromEntries((signedAttachments.data || []).map(item => [item.path, item.signedUrl]));
    const msgIds = rows.map(r => r.id);
    const { data: reactionRows } = msgIds.length
      ? await sb.from('message_reactions').select('message_id,user_id,emoji').in('message_id', msgIds)
      : { data: [] };
    const reactionMap = {};
    (reactionRows || []).forEach(r => {
      (reactionMap[r.message_id] ||= {})[r.emoji] ||= { count: 0, mine: false };
      reactionMap[r.message_id][r.emoji].count++;
      if (r.user_id === currentUser.id) reactionMap[r.message_id][r.emoji].mine = true;
    });
    const reactionsHTML = mid => {
      const r = reactionMap[mid];
      const chips = r ? Object.entries(r).map(([emoji, info]) =>
        `<button class="react-chip ${info.mine ? 'mine' : ''}" data-msg="${mid}" data-emoji="${emoji}" type="button">${emoji} ${info.count}</button>`).join('') : '';
      return `<div class="react-row">${chips}<button class="react-add" data-msg="${mid}" type="button" title="Tepki ekle">＋</button></div>`;
    };
    box.innerHTML = rows.length ? rows.map(row => row.deleted_at ? `
      <article class="chat-message deleted ${row.sender_id === currentUser.id ? 'mine' : ''}">
        <div class="chat-message-body small">Bu mesaj silindi.</div>
      </article>` : `
      <article class="chat-message ${row.sender_id === currentUser.id ? 'mine' : ''}" data-msg-id="${esc(row.id)}">
        ${row.sender_id !== currentUser.id ? `<div class="chat-message-author">${esc(displayName(senders[row.sender_id], 'Halka kullanıcısı'))}</div>` : ''}
        ${row.body ? `<div class="chat-message-body">${esc(row.body)}</div>` : ''}
        ${row.shared_post_id && posts[row.shared_post_id] ? chatPostPreview(posts[row.shared_post_id]) : ''}
        ${row.attachment_path && attachmentUrls[row.attachment_path] ? chatAttachmentHTML(row, attachmentUrls[row.attachment_path]) : row.attachment_path ? '<div class="small">Ek açılamadı.</div>' : ''}
        ${reactionsHTML(row.id)}
        <div class="chat-meta">
          ${esc(new Date(row.created_at).toLocaleString('tr-TR', { dateStyle:'short', timeStyle:'short' }))}
          ${row.edited_at ? '<span class="small">(düzenlendi)</span>' : ''}
          ${row.sender_id === currentUser.id ? `<span class="chat-receipts" title="${row.read_at ? 'Okundu' : row.delivered_at ? 'Ulaştı' : 'Gönderildi'}">${row.read_at ? '✓✓' : row.delivered_at ? '✓' : '∙'}</span>
            <button class="chat-msg-act" data-act="edit" data-msg="${row.id}" type="button" title="Düzenle">✎</button>
            <button class="chat-msg-act" data-act="del" data-msg="${row.id}" type="button" title="Sil">🗑</button>` : ''}
        </div>
      </article>`).join('') : '<div class="empty">Henüz mesaj yok. İlk mesajı sen gönder.</div>';
    if (scrollIfNearBottom || nearBottom) box.scrollTop = box.scrollHeight;
    markRead();
  };

  document.getElementById('chatMessages')?.addEventListener('click', async e => {
    const chip = e.target.closest('.react-chip');
    const add = e.target.closest('.react-add');
    const act = e.target.closest('.chat-msg-act');
    if (chip) {
      const { msg, emoji } = chip.dataset;
      const mine = chip.classList.contains('mine');
      const q = mine
        ? sb.from('message_reactions').delete().eq('message_id', msg).eq('user_id', currentUser.id).eq('emoji', emoji)
        : sb.from('message_reactions').insert({ message_id: msg, user_id: currentUser.id, emoji });
      await q;
      await loadMessages(false);
      return;
    }
    if (add) {
      const picker = add.parentElement.querySelector('.react-picker');
      if (picker) { picker.remove(); return; }
      const p = document.createElement('div');
      p.className = 'react-picker';
      p.innerHTML = ['❤️', '😂', '👍', '😮', '🔥'].map(e => `<button type="button" data-emoji="${e}">${e}</button>`).join('');
      add.parentElement.appendChild(p);
      p.querySelectorAll('button').forEach(b => b.addEventListener('click', async () => {
        await sb.from('message_reactions').insert({ message_id: add.dataset.msg, user_id: currentUser.id, emoji: b.dataset.emoji });
        await loadMessages(false);
      }));
      return;
    }
    if (act) {
      const msgId = act.dataset.msg;
      if (act.dataset.act === 'del') {
        if (!confirm('Bu mesajı silmek istiyor musun?')) return;
        await sb.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', msgId);
      } else {
        const bodyEl2 = act.closest('.chat-message').querySelector('.chat-message-body');
        const next = prompt('Mesajı düzenle:', bodyEl2?.textContent || '');
        if (next === null) return;
        const trimmed = next.trim();
        if (!trimmed || trimmed.length > 4000) return;
        await sb.from('messages').update({ body: trimmed, edited_at: new Date().toISOString() }).eq('id', msgId);
      }
      await loadMessages(false);
    }
  });
  const blockedInChat = async () => {
    const members = (memberMap.get(activeId) || []).filter(uid => uid !== currentUser.id);
    for (const uid of members) {
      const result = await sb.rpc('is_blocked', { checker: currentUser.id, target: uid });
      if (result.data) return true;
    }
    return false;
  };

  document.getElementById('chatComposeForm').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const bodyEl = document.getElementById('chatMessageBody');
    const body = bodyEl.value.trim();
    const fileInput = document.getElementById('chatAttachment');
    const file = fileInput.files?.[0] || null;
    if (!body && !sharedPost && !file) return;
    if (await blockedInChat()) { setSettingsMessage(document.getElementById('chatSendMessage'), 'Engellenmiş bir kullanıcıya mesaj gönderemezsin.', true); return; }
    if (file) {
      const allowed = ['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','application/pdf'];
      if (!allowed.includes(file.type)) return setSettingsMessage(document.getElementById('chatSendMessage'), 'Bu dosya türü desteklenmiyor. JPG, PNG, WebP, GIF, MP4, WebM veya PDF seç.', true);
      if (file.size > 25 * 1024 * 1024) return setSettingsMessage(document.getElementById('chatSendMessage'), 'Dosya 25 MB sınırını aşıyor.', true);
    }
    const button = form.querySelector('button[type="submit"]');
    const status = document.getElementById('chatSendMessage');
    button.disabled = true;
    let attachmentPath = null;
    if (file) {
      setSettingsMessage(status, 'Dosya yükleniyor…');
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'dosya';
      attachmentPath = `${activeId}/${currentUser.id}/${crypto.randomUUID()}-${safeName}`;
      const upload = await sb.storage.from('chat-media').upload(attachmentPath, file, { contentType: file.type, upsert: false });
      if (upload.error) {
        button.disabled = false;
        return setSettingsMessage(status, `Dosya yüklenemedi: ${upload.error.message}. Sohbet dosyaları için veritabanı güncellemesi gerekebilir.`, true);
      }
    }
    setSettingsMessage(status, 'Mesaj gönderiliyor…');
    const messageRow = { conversation_id: activeId, sender_id: currentUser.id, body, shared_post_id: sharedPost?.id || null, delivered_at: new Date().toISOString() };
    if (file) Object.assign(messageRow, { attachment_path: attachmentPath, attachment_mime: file.type, attachment_name: file.name });
    const { error } = await sb.from('messages').insert(messageRow);
    if (error && attachmentPath) await sb.storage.from('chat-media').remove([attachmentPath]);
    button.disabled = false;
    if (error) { setSettingsMessage(status, `Mesaj gönderilemedi: ${error.message}`, true); return; }
    bodyEl.value = '';
    fileInput.value = '';
    document.getElementById('chatAttachmentName').textContent = 'En fazla 25 MB';
    setSettingsMessage(status, '');
    if (sharePostId) { location.hash = `#/chat/${encodeURIComponent(activeId)}`; return; }
    await loadMessages(true);
  });
  document.getElementById('chatAttachment').addEventListener('change', event => {
    const file = event.currentTarget.files?.[0];
    document.getElementById('chatAttachmentName').textContent = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : 'En fazla 25 MB';
  });
  await loadMessages(true);
  if (chatChannel) { sb.removeChannel(chatChannel); chatChannel = null; }
  const typingEl = document.createElement('div');
  typingEl.className = 'chat-typing small';
  typingEl.hidden = true;
  document.getElementById('chatMessages')?.parentElement?.insertBefore(typingEl, document.getElementById('chatComposeForm'));
  chatChannel = sb.channel(`chat-${activeId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${activeId}` }, () => loadMessages(false))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, () => loadMessages(false))
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload.user === currentUser.id) return;
      typingEl.textContent = `${payload.name || 'Biri'} yazıyor…`;
      typingEl.hidden = false;
      clearTimeout(typingHideTimer);
      typingHideTimer = setTimeout(() => { typingEl.hidden = true; }, 3000);
    })
    .subscribe();
  chatRefreshTimer = setInterval(() => loadMessages(false), 30000);
  let typingSentAt = 0;
  document.getElementById('chatMessageBody')?.addEventListener('input', () => {
    if (Date.now() - typingSentAt < 2000 || !chatChannel) return;
    typingSentAt = Date.now();
    try { chatChannel.send({ type: 'broadcast', event: 'typing', payload: { user: currentUser.id, name: displayName(currentProfile) } }); } catch {}
  });
}

function chatAttachmentHTML(row, url) {
  const mime = String(row.attachment_mime || '');
  const name = esc(row.attachment_name || 'Paylaşılan dosya');
  if (mime.startsWith('image/')) return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><img class="chat-attachment-preview" src="${esc(url)}" alt="${name}" loading="lazy"></a>`;
  if (mime.startsWith('video/')) return `<video class="chat-attachment-preview" src="${esc(url)}" controls preload="metadata"></video>`;
  return `<a class="chat-attachment-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">PDF dosyasını aç: ${name}</a>`;
}

function chatPostPreview(post) {
  if (!post) return '';
  const media = post.media_url ? mediaHTML(post) : '';
  const kindLabel = quickTypeLabel(post);
  return `<a class="shared-post" href="#/read/${encodeURIComponent(post.id)}"><div class="small">${esc(kindLabel)}</div>${postCoverHTML(post)}${media}<strong>${esc(post.title || 'Başlıksız eser')}</strong><div class="post-tags">${hashtagHTML(post)}</div>${post.description ? `<div class="small" style="margin-top:4px">${esc(post.description.slice(0,180))}</div>` : ''}</a>`;
}

function setSettingsMessage(element, text, error = false) {
  element.textContent = text;
  element.className = error ? 'message error' : 'message';
}

const SECTIONS = {
  yazilar: { label: 'Yazılar', type: 'writing', groups: [
    { title: 'Yazı türü', param: 'kind', items: [['Blog', 'blog'], ['Kısa Yazı', 'short'], ['Kitap', 'book'], ['Manga', 'manga'], ['Light Novel', 'light_novel']] },
    { title: 'Hashtag', param: 'cat', items: categories.filter(c => c !== 'Diğer').map(c => [c, tagSlug(c)]) }
  ]},
  cizimler: { label: 'Çizimler', type: 'drawing', groups: [
    { title: 'Hashtag', param: 'cat', items: ['Karakalem', 'Dijital çizim', 'Karakter tasarımı', 'Manga ve çizgi roman', 'Karikatür', 'Suluboya'].map(x => [x, tagSlug(x)]) }
  ]},
  fotograflar: { label: 'Fotoğraflar', type: 'photo', groups: [
    { title: 'Hashtag', param: 'cat', items: ['Doğa', 'Portre', 'Sokak', 'Şehir', 'Siyah beyaz', 'Makro'].map(x => [x, tagSlug(x)]) }
  ]},
  videolar: { label: 'Videolar', type: 'video', groups: [
    { title: 'Hashtag', param: 'cat', items: ['Kısa film', 'Animasyon', 'Vlog', 'Eğitim', 'Komedi'].map(x => [x, tagSlug(x)]) }
  ]},
  muzikler: { label: 'Müzik', type: 'music', groups: [
    { title: 'Hashtag', param: 'cat', items: ['Pop', 'Rock', 'Rap', 'Klasik', 'Elektronik', 'Akustik', 'Enstrümantal', 'Cover'].map(x => [x, tagSlug(x)]) }
  ]},
  topluluklar: { label: 'Topluluklar', type: 'community', groups: [
    { title: 'Topluluklar', param: 'sub', items: [['Topluluklarım', 'uyelerim'], ['Yeni topluluk kur', 'yeni']] }
  ]},
  kesfet: { label: 'Keşfet', type: null, groups: [
    { title: 'Keşfet biçimi', param: 'sub', items: [['Normal keşfet', 'normal'], ['Hızlı keşfet', 'hizli']] },
    { title: 'Diğer', param: 'sub', items: [['Yazarlar', 'yazarlar'], ['Rastgele bir eser', 'rastgele']] }
  ]}
};

const CREATE_MENU = [
  { label: 'Yazı', items: [['Blog', '#/write?kind=blog'], ['Kısa Yazı', '#/write?kind=short'], ['Kitap', '#/write?kind=book'], ['Manga', '#/write?kind=manga'], ['Light Novel', '#/write?kind=light_novel'], ['⚡ Nöbetleşe hikâye', '#/relay']] },
  { label: 'Çizim', items: [['Tuvalde çiz', '#/create/drawing?mode=canvas'], ['Dosya yükle', '#/create/drawing?mode=file']] },
  { label: 'Fotoğraf', items: [['Kamerayla çek', '#/create/photo?mode=camera'], ['Galeriden seç', '#/create/photo?mode=file']] },
  { label: 'Video', items: [['Kamerayla kaydet', '#/create/video?mode=camera'], ['Dosya yükle', '#/create/video?mode=file']] },
  { label: 'Müzik', items: [['Ses dosyası yükle', '#/create/music?mode=file'], ['Kayıt yap', '#/create/music?mode=record'], ['Bağlantı ekle', '#/create/music?mode=link']] },
  { label: 'Topluluk', items: [['Topluluk kur', '#/section/topluluklar?sub=yeni'], ['Topluluklara göz at', '#/section/topluluklar']] }
];

const secLink = (key, param, val) => `#/section/${key}${param ? `?${param}=${encodeURIComponent(val)}` : ''}`;
const loadingBlock = text => `<div class="loading"><div class="spinner-container"><div class="spinner-rings"></div><span>${esc(text)}</span></div></div>`;

function renderTabs() {
  const el = document.getElementById('tabs');
  if (!el) return;
  const { parts } = parseRoute();
  const activeKey = parts[0] === 'section' ? parts[1] : '';
  el.innerHTML = Object.entries(SECTIONS).map(([key, s]) => `
    <div class="dd">
      <button class="tab ${key === activeKey ? 'on' : ''}" type="button" data-menu="${key}" aria-haspopup="true" aria-expanded="false">${esc(s.label)} <span class="caret">▾</span></button>
      <div class="dd-panel" id="menu-${key}" hidden>
        <a href="${secLink(key)}">Tümü</a>
        ${s.groups.map(g => `<div class="grp">${esc(g.title)}</div>${g.items.map(([label, val]) => `<a href="${secLink(key, g.param, val)}">${esc(label)}</a>`).join('')}`).join('')}
      </div>
    </div>`).join('');
}

function plusMenuHTML() {
  return `
    <div class="dd">
      <button class="plus" type="button" data-menu="plus" aria-label="Yeni paylaşım" aria-haspopup="true" aria-expanded="false">+</button>
      <div class="dd-panel right" id="menu-plus" hidden>
        <div class="grp">Ne paylaşmak istersin?</div>
        ${CREATE_MENU.map(o => `
          <button class="acc" type="button" data-acc="1">${esc(o.label)} <span>▸</span></button>
          <div class="acc-body" hidden>${o.items.map(([l, h]) => `<a href="${h}">${esc(l)}</a>`).join('')}</div>`).join('')}
      </div>
    </div>`;
}

function closeMenus() {
  document.querySelectorAll('.dd-panel').forEach(p => { p.hidden = true; });
  document.querySelectorAll('[data-menu]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}
document.addEventListener('click', e => {
  const acc = e.target.closest('[data-acc]');
  if (acc) {
    const body = acc.nextElementSibling;
    const open = body.hidden;
    const panel = acc.parentElement;
    panel.querySelectorAll('.acc-body').forEach(b => { b.hidden = true; });
    panel.querySelectorAll('.acc span').forEach(sp => { sp.textContent = '▸'; });
    body.hidden = !open;
    acc.querySelector('span').textContent = open ? '▾' : '▸';
    return;
  }
  const btn = e.target.closest('[data-menu]');
  if (btn) {
    const panel = document.getElementById('menu-' + btn.dataset.menu);
    const wasHidden = panel.hidden;
    closeMenus();
    panel.hidden = !wasHidden;
    btn.setAttribute('aria-expanded', String(wasHidden));
    if (!panel.hidden && !panel.classList.contains('right')) {
      panel.classList.remove('align-right');
      if (panel.getBoundingClientRect().right > window.innerWidth - 8) panel.classList.add('align-right');
    }
    return;
  }
  closeMenus();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });
document.addEventListener('change', e => {
  const input = e.target;
  if (!(input instanceof HTMLInputElement) || input.type !== 'file') return;
  let span = input.parentElement?.querySelector('.file-name');
  if (!span) {
    span = document.createElement('span');
    span.className = 'file-name';
    input.insertAdjacentElement('afterend', span);
  }
  span.textContent = input.files?.[0]?.name || 'Dosya seçilmedi';
});

function openCoverMaker() {
  document.getElementById('coverMakerModal')?.remove();
  const PALETTES = [
    ['#1e3a8a', '#0ea5e9'], ['#7c2d12', '#ea580c'], ['#14532d', '#22c55e'],
    ['#581c87', '#c026d3'], ['#0f172a', '#334155'], ['#78350f', '#f59e0b']
  ];
  const modal = document.createElement('div');
  modal.id = 'coverMakerModal';
  modal.className = 'badge-modal-backdrop';
  modal.innerHTML = `
    <div class="card badge-modal" style="max-width:640px;text-align:left">
      <button class="badge-modal-close" type="button" aria-label="Kapat">✕</button>
      <h3 style="text-align:center">🎨 Kapak oluşturucu</h3>
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
        <canvas id="coverCanvas" width="400" height="600" style="border-radius:10px;max-width:45%;border:1px solid var(--line)"></canvas>
        <div style="flex:1;min-width:200px;display:flex;flex-direction:column;gap:10px">
          <div class="field"><label>Başlık</label><input id="cmTitle" maxlength="60" value="${esc(document.getElementById('title')?.value || '')}"></div>
          <div class="field"><label>Yazar adı</label><input id="cmAuthor" maxlength="40" value="${esc(displayName(currentProfile || { display_name: currentUser?.user_metadata?.display_name }))}"></div>
          <div class="field"><label>Simge (isteğe bağlı)</label><input id="cmEmoji" maxlength="4" placeholder="🌙"></div>
          <div class="field"><label>Renk paleti</label>
            <div style="display:flex;gap:6px;flex-wrap:wrap">${PALETTES.map((p, i) => `
              <button class="cm-swatch" type="button" data-i="${i}" style="width:36px;height:36px;border-radius:8px;border:2px solid transparent;background:linear-gradient(135deg,${p[0]},${p[1]})"></button>`).join('')}</div>
          </div>
          <button class="btn primary" id="cmUse" type="button">Kapağı kullan</button>
        </div>
      </div>
      <div id="cmMessage" class="message" aria-live="polite"></div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  modal.querySelector('.badge-modal-close').addEventListener('click', close);

  let palette = PALETTES[0];
  const canvas = modal.querySelector('#coverCanvas');
  const ctx = canvas.getContext('2d');
  const draw = () => {
    const w = canvas.width, h = canvas.height;
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, palette[0]);
    grad.addColorStop(1, palette[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    const emoji = modal.querySelector('#cmEmoji').value.trim();
    if (emoji) { ctx.font = '110px serif'; ctx.textAlign = 'center'; ctx.fillText(emoji, w / 2, h * 0.32); }
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    const title = modal.querySelector('#cmTitle').value.trim() || 'Başlıksız';
    let size = 52;
    ctx.font = `bold ${size}px Georgia, serif`;
    while (size > 22 && ctx.measureText(title).width > w - 50) { size -= 4; ctx.font = `bold ${size}px Georgia, serif`; }
    const words = title.split(' ');
    const lines = [];
    let line = '';
    words.forEach(word => {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > w - 50 && line) { lines.push(line); line = word; } else line = test;
    });
    if (line) lines.push(line);
    const ty = h * 0.52;
    lines.slice(0, 4).forEach((l, i) => ctx.fillText(l, w / 2, ty + i * (size + 10)));
    const author = modal.querySelector('#cmAuthor').value.trim();
    ctx.font = '26px Georgia, serif';
    if (author) ctx.fillText(author, w / 2, h - 60);
  };
  ['cmTitle', 'cmAuthor', 'cmEmoji'].forEach(id => modal.querySelector('#' + id).addEventListener('input', draw));
  modal.querySelectorAll('.cm-swatch').forEach(btn => btn.addEventListener('click', () => {
    palette = PALETTES[Number(btn.dataset.i)];
    modal.querySelectorAll('.cm-swatch').forEach(b => b.style.borderColor = 'transparent');
    btn.style.borderColor = '#fff';
    draw();
  }));
  modal.querySelector('.cm-swatch').style.borderColor = '#fff';
  draw();
  modal.querySelector('#cmUse').addEventListener('click', () => {
    canvas.toBlob(blob => {
      if (!blob) return setSettingsMessage(document.getElementById('cmMessage'), 'Kapak oluşturulamadı.', true);
      const file = new File([blob], 'kapak.png', { type: 'image/png' });
      const input = document.getElementById('bookCover');
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      close();
    }, 'image/png');
  });
}

// ---- Manga panel kompozitörü v2: hazır/özel şablon → çiz/görsel/ton → balon → PNG ----
function openPanelComposer(onDone) {
  const W = 760, H = 1080, GUT = 14;
  let BORDER = 5;
  const LAYOUTS = {
    '1 tam sayfa': [[0, 0, 1, 1]],
    '2 dikey': [[0, 0, 1, .5], [0, .5, 1, .5]],
    '2 yatay': [[0, 0, .5, 1], [.5, 0, .5, 1]],
    '3 (üst + 2 alt)': [[0, 0, 1, .5], [0, .5, .5, .5], [.5, .5, .5, .5]],
    '4 ızgara': [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]],
    '6 ızgara': [[0, 0, .5, 1 / 3], [.5, 0, .5, 1 / 3], [0, 1 / 3, .5, 1 / 3], [.5, 1 / 3, .5, 1 / 3], [0, 2 / 3, .5, 1 / 3], [.5, 2 / 3, .5, 1 / 3]],
    'Özel düzen': null
  };
  const SPLITS = {
    '1': [1], '2': [.5, .5], '2 (sol geniş)': [.66, .34], '2 (sağ geniş)': [.34, .66],
    '3': [1 / 3, 1 / 3, 1 / 3], '4': [.25, .25, .25, .25]
  };
  const TONES = ['Yok', 'Nokta (seyrek)', 'Nokta (sık)', 'Çizgi (yatay)', 'Çizgi (çapraz)', 'Gradyan'];
  const modal = document.createElement('div');
  modal.className = 'badge-modal-backdrop';
  modal.innerHTML = `
    <div class="card badge-modal pc-modal">
      <button class="badge-modal-close" type="button" aria-label="Kapat">✕</button>
      <h3 style="text-align:center;margin:0 0 10px">🎨 Panel oluşturucu</h3>
      <div class="canvas-tool-row" style="flex-wrap:wrap;gap:6px;margin-bottom:8px">
        <label class="small">Şablon</label>
        <select id="pcLayout">${Object.keys(LAYOUTS).map(k => `<option>${k}</option>`).join('')}</select>
        <button class="btn ghost small pc-tool on" data-tool="pen" type="button" title="Kalem">✏️</button>
        <button class="btn ghost small pc-tool" data-tool="marker" type="button" title="Fosforlu">🖊️</button>
        <button class="btn ghost small pc-tool" data-tool="eraser" type="button" title="Silgi">🧽</button>
        <button class="btn ghost small pc-tool" data-tool="tone" type="button" title="Ton dokusu">▩</button>
        <button class="btn ghost small pc-tool" data-tool="bubble" type="button" title="Balon">💬</button>
        <button class="btn ghost small pc-tool" data-tool="move" type="button" title="Taşı">✋</button>
        <input type="range" id="pcSize" min="2" max="24" value="4" title="Çizgi boyutu" style="width:60px">
        <input type="color" id="pcColor" value="#111111" title="Renk">
        <label class="small" title="Panel çerçevesi">Çerçeve</label>
        <input type="range" id="pcBorder" min="0" max="12" value="5" style="width:55px">
        <button class="btn ghost small" id="pcImgBtn" type="button" title="Panele görsel">🖼️</button>
        <input id="pcImgFile" type="file" accept="image/jpeg,image/png,image/webp" hidden>
        <button class="btn ghost small" id="pcUndo" type="button" title="Geri al">↩</button>
        <button class="btn ghost small" id="pcClear" type="button" title="Temizle">🗑</button>
      </div>
      <div id="pcCustomBar" style="display:none;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <div id="pcRows" style="display:grid;gap:6px;width:100%"></div>
        <button class="btn ghost small" id="pcAddRow" type="button">+ Satır ekle</button>
        <span class="small">Her satırın bölünmesini ve yüksekliğini seç — paneller otomatik dizilir.</span>
      </div>
      <div id="pcBubbleBar" style="display:none;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <select id="pcBubbleType">
          <option value="speech">Konuşma</option><option value="thought">Düşünce</option>
          <option value="shout">Bağırma</option><option value="narration">Anlatıcı</option>
        </select>
        <select id="pcBubbleTail" title="Kuyruk yönü">
          <option value="down">Kuyruk ↓</option><option value="up">Kuyruk ↑</option>
          <option value="left">Kuyruk ←</option><option value="right">Kuyruk →</option>
        </select>
        <select id="pcBubbleSize" title="Yazı boyutu">
          <option value="14">S</option><option value="18" selected>M</option>
          <option value="24">L</option><option value="30">XL</option>
        </select>
        <input id="pcBubbleText" maxlength="120" placeholder="Balon metni…" style="flex:1;min-width:140px">
        <span class="small">Sonra panelde bir yere tıkla.</span>
      </div>
      <div id="pcToneBar" style="display:none;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <select id="pcTone">${TONES.map(t => `<option>${t}</option>`).join('')}</select>
        <span class="small">Panelde bir yere tıkla — ton arka plana işlenir.</span>
      </div>
      <canvas id="pcCanvas" width="${W}" height="${H}" class="pc-canvas"></canvas>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:12px">
        <button class="btn primary" id="pcDone" type="button">Sayfayı kullan</button>
      </div>
      <div id="pcMessage" class="message" aria-live="polite"></div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  modal.querySelector('.badge-modal-close').addEventListener('click', close);

  const canvas = modal.querySelector('#pcCanvas');
  const ctx = canvas.getContext('2d');
  let panels = [];          // {x,y,w,h, img, tone, strokes:[], bubbles:[]}
  let tool = 'pen', activePanel = -1, drawing = false, dragBubble = null;
  const ops = [];           // undo geçmişi: {type:'stroke'|'bubble'|'img'|'tone', panel, ref/prev}
  let customRows = [{ split: '1', h: 1 }, { split: '2', h: 1 }];

  // Ton dokusu desenleri (küçük tekrarlanan tile)
  const toneCache = {};
  const toneCanvas = name => {
    if (toneCache[name]) return toneCache[name];
    const t = document.createElement('canvas');
    const s = { 'Nokta (seyrek)': 14, 'Nokta (sık)': 8, 'Çizgi (yatay)': 10, 'Çizgi (çapraz)': 12 }[name] || 8;
    t.width = t.height = s;
    const c = t.getContext('2d');
    c.strokeStyle = c.fillStyle = '#111';
    if (name.startsWith('Nokta')) {
      c.beginPath(); c.arc(s / 2, s / 2, name.includes('sık') ? 1.6 : 1.9, 0, Math.PI * 2); c.fill();
    } else if (name === 'Çizgi (yatay)') {
      c.lineWidth = 1.4; c.beginPath(); c.moveTo(0, s / 2); c.lineTo(s, s / 2); c.stroke();
    } else if (name === 'Çizgi (çapraz)') {
      c.lineWidth = 1.2; c.beginPath(); c.moveTo(0, s); c.lineTo(s, 0); c.stroke();
      c.beginPath(); c.moveTo(-s, 0); c.lineTo(0, -s); c.stroke();
      c.beginPath(); c.moveTo(s, 2 * s); c.lineTo(2 * s, s); c.stroke();
    }
    toneCache[name] = t;
    return t;
  };

  const mkPanel = (x, y, w, h) => ({
    x: x * W + GUT / 2, y: y * H + GUT / 2,
    w: w * W - GUT, h: h * H - GUT,
    img: null, tone: null, strokes: [], bubbles: []
  });

  const buildCustom = () => {
    const rows = customRows.filter(r => SPLITS[r.split]);
    if (!rows.length) rows.push({ split: '1', h: 1 });
    const totalH = rows.reduce((m, r) => m + (r.h || 1), 0);
    let y = 0;
    panels = [];
    rows.forEach(r => {
      const rh = (r.h || 1) / totalH;
      const widths = SPLITS[r.split];
      let x = 0;
      widths.forEach(wf => { panels.push(mkPanel(x, y, wf, rh)); x += wf; });
      y += rh;
    });
    ops.length = 0;
    redraw();
  };

  const setLayout = key => {
    if (!LAYOUTS[key]) return buildCustom();
    panels = LAYOUTS[key].map(([x, y, w, h]) => mkPanel(x, y, w, h));
    ops.length = 0;
    redraw();
  };
  const panelAt = (x, y) => panels.findIndex(p => x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h);
  const pos = e => {
    const r = canvas.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: (p.clientX - r.left) * (W / r.width), y: (p.clientY - r.top) * (H / r.height) };
  };

  const drawBubble = b => {
    ctx.save();
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#111'; ctx.fillStyle = '#fff';
    const cx = b.x, cy = b.y, rx = b.w / 2, ry = b.h / 2;
    ctx.beginPath();
    if (b.type === 'narration') ctx.rect(cx - rx, cy - ry, b.w, b.h);
    else if (b.type === 'shout') {
      const spikes = 14;
      for (let i = 0; i <= spikes * 2; i++) {
        const a = (i / (spikes * 2)) * Math.PI * 2;
        const rr = i % 2 ? 0.78 : 1;
        const px = cx + Math.cos(a) * rx * rr, py = cy + Math.sin(a) * ry * rr;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
    } else {
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      if (b.type === 'thought') ctx.setLineDash([6, 5]);
    }
    ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
    if (b.type !== 'narration') { // kuyruk — b.tail: down/up/left/right
      ctx.beginPath();
      const T = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }[b.tail || 'down'];
      if (b.type === 'thought') {
        const bx = cx + T[0] * rx * 0.9, by = cy + T[1] * ry * 0.9;
        [[bx, by, 7], [bx + T[0] * 14 - (T[0] ? 0 : 12), by + T[1] * 14 - (T[1] ? 0 : -12), 4.5]].forEach(([px, py, r]) => {
          ctx.moveTo(px + r, py); ctx.arc(px, py, r, 0, Math.PI * 2);
        });
        ctx.fill(); ctx.stroke();
      } else {
        const edge = T[1] ? { x: cx - rx * 0.35, y: cy + T[1] * ry * 0.8 } : { x: cx + T[0] * rx * 0.85, y: cy - ry * 0.3 };
        const edge2 = T[1] ? { x: cx + rx * 0.05, y: cy + T[1] * ry * 0.82 } : { x: cx + T[0] * rx * 0.9, y: cy + ry * 0.15 };
        ctx.moveTo(edge.x, edge.y);
        ctx.lineTo(cx + T[0] * (rx + 26), cy + T[1] * (ry + 26));
        ctx.lineTo(edge2.x, edge2.y);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
    // metin
    ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const size = b.size || 18; ctx.font = `${size}px 'Segoe UI', sans-serif`;
    const words = b.text.split(' ');
    const lines = []; let line = '';
    words.forEach(wd => {
      const t = line ? `${line} ${wd}` : wd;
      if (ctx.measureText(t).width > b.w - 22 && line) { lines.push(line); line = wd; } else line = t;
    });
    if (line) lines.push(line);
    const lh = size + 4, ty = cy - ((lines.length - 1) * lh) / 2;
    lines.slice(0, 5).forEach((l, i) => ctx.fillText(l, cx, ty + i * lh));
    ctx.restore();
  };

  function redraw() {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    panels.forEach((p, i) => {
      ctx.save();
      ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip();
      ctx.fillStyle = '#fff'; ctx.fillRect(p.x, p.y, p.w, p.h);
      if (p.img) { // cover-fit
        const s = Math.max(p.w / p.img.width, p.h / p.img.height);
        const iw = p.img.width * s, ih = p.img.height * s;
        ctx.drawImage(p.img, p.x + (p.w - iw) / 2, p.y + (p.h - ih) / 2, iw, ih);
      }
      if (p.tone && p.tone !== 'Yok') { // screentone: görselin üstüne, çizgilerin altına
        ctx.globalAlpha = 0.45;
        if (p.tone === 'Gradyan') {
          const g = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.h);
          g.addColorStop(0, '#0000'); g.addColorStop(1, '#0009');
          ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(p.x, p.y, p.w, p.h);
        } else {
          ctx.fillStyle = ctx.createPattern(toneCanvas(p.tone), 'repeat');
          ctx.fillRect(p.x, p.y, p.w, p.h);
        }
        ctx.globalAlpha = 1;
      }
      p.strokes.forEach(st => {
        ctx.strokeStyle = st.color; ctx.lineWidth = st.size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        if (st.erase) ctx.globalCompositeOperation = 'destination-out';
        else if (st.alpha) ctx.globalAlpha = st.alpha;
        ctx.beginPath();
        st.pts.forEach((pt, j) => j ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y));
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      });
      ctx.restore();
      ctx.lineWidth = BORDER; ctx.strokeStyle = '#111'; ctx.strokeRect(p.x, p.y, p.w, p.h);
      if (i === activePanel) { ctx.lineWidth = 2; ctx.strokeStyle = '#E8923C'; ctx.strokeRect(p.x - 2, p.y - 2, p.w + 4, p.h + 4); }
      p.bubbles.forEach(drawBubble);
    });
  }

  const down = e => {
    e.preventDefault();
    const { x, y } = pos(e);
    const pi = panelAt(x, y);
    if (['pen','marker','eraser'].includes(tool) && pi >= 0) {
      drawing = true; activePanel = pi;
      const size = Number(modal.querySelector('#pcSize').value);
      const st = {
        color: modal.querySelector('#pcColor').value,
        size: tool === 'marker' ? size * 3 : tool === 'eraser' ? size * 3 : size,
        alpha: tool === 'marker' ? 0.4 : 1,
        erase: tool === 'eraser',
        pts: [{ x, y }]
      };
      panels[pi].strokes.push(st); ops.push({ type: 'stroke', panel: pi, ref: st });
      redraw();
    } else if (tool === 'bubble' && pi >= 0) {
      const text = modal.querySelector('#pcBubbleText').value.trim();
      if (!text) return;
      const size = Number(modal.querySelector('#pcBubbleSize').value) || 18;
      const b = {
        x, y, w: Math.max(150, Math.min(320, size * 9.5)),
        h: Math.min(150, 40 + Math.ceil(text.length / Math.max(14, 300 / (size * 0.62))) * (size + 6)),
        type: modal.querySelector('#pcBubbleType').value,
        tail: modal.querySelector('#pcBubbleTail').value,
        size, text
      };
      panels[pi].bubbles.push(b); ops.push({ type: 'bubble', panel: pi, ref: b });
      redraw();
    } else if (tool === 'tone' && pi >= 0) {
      const tone = modal.querySelector('#pcTone').value;
      ops.push({ type: 'tone', panel: pi, prev: panels[pi].tone });
      panels[pi].tone = tone === 'Yok' ? null : tone;
      redraw();
    } else if (tool === 'move') {
      outer: for (const p of panels) for (const b of p.bubbles)
        if (Math.hypot(x - b.x, y - b.y) < Math.max(b.w, b.h) / 2) { dragBubble = { b, dx: x - b.x, dy: y - b.y }; break outer; }
    }
  };
  const move = e => {
    if (!drawing && !dragBubble) return;
    e.preventDefault();
    const { x, y } = pos(e);
    if (drawing) {
      const st = panels[activePanel].strokes.at(-1);
      st.pts.push({ x, y }); redraw();
    } else if (dragBubble) {
      dragBubble.b.x = x - dragBubble.dx; dragBubble.b.y = y - dragBubble.dy; redraw();
    }
  };
  const up = () => { drawing = false; dragBubble = null; };
  canvas.addEventListener('mousedown', down);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  canvas.addEventListener('touchstart', down, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', up);

  // Özel düzen: satır kurucusu
  const rowsBox = modal.querySelector('#pcRows');
  const renderRows = () => {
    rowsBox.innerHTML = customRows.map((r, i) => `
      <div class="pc-row" style="display:flex;gap:6px;align-items:center">
        <span class="small" style="width:52px">Satır ${i + 1}</span>
        <select data-row="${i}" data-k="split">${Object.keys(SPLITS).map(s => `<option${s === r.split ? ' selected' : ''}>${s}</option>`).join('')}</select>
        <select data-row="${i}" data-k="h">${[[.55, 'kısa'], [1, 'normal'], [1.6, 'uzun']].map(([v, l]) => `<option value="${v}"${v === r.h ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn ghost small" data-del="${i}" type="button" title="Satırı sil">✕</button>
      </div>`).join('');
  };
  renderRows();
  rowsBox.addEventListener('change', e => {
    const i = Number(e.target.dataset.row);
    if (!Number.isFinite(i)) return;
    customRows[i][e.target.dataset.k] = e.target.dataset.k === 'h' ? Number(e.target.value) : e.target.value;
    buildCustom();
  });
  rowsBox.addEventListener('click', e => {
    const i = e.target.dataset?.del;
    if (i === undefined) return;
    customRows.splice(Number(i), 1);
    renderRows(); buildCustom();
  });
  modal.querySelector('#pcAddRow').addEventListener('click', () => {
    if (customRows.length >= 5) return;
    customRows.push({ split: '2', h: 1 });
    renderRows(); buildCustom();
  });

  modal.querySelector('#pcLayout').addEventListener('change', e => {
    modal.querySelector('#pcCustomBar').style.display = e.target.value === 'Özel düzen' ? 'flex' : 'none';
    setLayout(e.target.value);
  });
  modal.querySelector('#pcBorder').addEventListener('input', e => { BORDER = Number(e.target.value); redraw(); });
  modal.querySelectorAll('.pc-tool').forEach(b => b.addEventListener('click', () => {
    tool = b.dataset.tool;
    modal.querySelectorAll('.pc-tool').forEach(x => x.classList.toggle('on', x === b));
    modal.querySelector('#pcBubbleBar').style.display = tool === 'bubble' ? 'flex' : 'none';
    modal.querySelector('#pcToneBar').style.display = tool === 'tone' ? 'flex' : 'none';
    modal.querySelector('#pcColor').style.visibility = ['pen','marker'].includes(tool) ? 'visible' : 'hidden';
    canvas.style.cursor = tool === 'move' ? 'grab' : 'crosshair';
  }));
  modal.querySelector('#pcImgBtn').addEventListener('click', () => modal.querySelector('#pcImgFile').click());
  modal.querySelector('#pcImgFile').addEventListener('change', async e => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    const pi = activePanel >= 0 ? activePanel : 0;
    try { panels[pi].img = await createImageBitmap(f); ops.push({ type: 'img', panel: pi }); redraw(); }
    catch { setSettingsMessage(modal.querySelector('#pcMessage'), 'Görsel yüklenemedi.', true); }
  });
  modal.querySelector('#pcUndo').addEventListener('click', () => {
    const op = ops.pop(); if (!op) return;
    if (op.type === 'img') panels[op.panel].img = null;
    else if (op.type === 'tone') panels[op.panel].tone = op.prev;
    else { const arr = op.type === 'stroke' ? panels[op.panel].strokes : panels[op.panel].bubbles;
      arr.splice(arr.indexOf(op.ref), 1); }
    redraw();
  });
  modal.querySelector('#pcClear').addEventListener('click', () => setLayout(modal.querySelector('#pcLayout').value));
  modal.querySelector('#pcDone').addEventListener('click', () => {
    canvas.toBlob(blob => {
      if (!blob) return setSettingsMessage(modal.querySelector('#pcMessage'), 'Sayfa oluşturulamadı.', true);
      onDone(blob); close();
    }, 'image/png');
  });
  setLayout('4 ızgara');
}

async function compressImage(file, maxDim = 1920, quality = 0.82) {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
  } catch { return file; }
}

// post-media bucket private: public URL'den path çıkarıp 1 saatlik imzalı link üretir.
// Dış bağlantılar (YouTube/Spotify) ve zaten imzalı URL'ler dokunulmadan kalır.
const MEDIA_PUBLIC_RE = /\/storage\/v1\/object\/public\/post-media\/(.+)$/;
async function signPostMedia(items, fields = ['media_url']) {
  const pathOf = {};
  (items || []).forEach(it => {
    if (!it) return;
    fields.forEach(f => {
      const m = String(it[f] || '').match(MEDIA_PUBLIC_RE);
      if (m) pathOf[it[f]] = m[1];
    });
  });
  const urls = Object.keys(pathOf);
  if (!urls.length) return;
  const { data } = await sb.storage.from('post-media').createSignedUrls(urls.map(u => pathOf[u]), 3600);
  const signed = {};
  (data || []).forEach((r, i) => {
    if (!r?.signedUrl) return;
    const s = r.signedUrl;
    signed[urls[i]] = /^https?:/.test(s) ? s : `${SUPABASE_URL}/storage/v1${s.startsWith('/') ? '' : '/'}${s}`;
  });
  (items || []).forEach(it => {
    if (!it) return;
    fields.forEach(f => { if (signed[it[f]]) it[f] = signed[it[f]]; });
  });
}

function mediaHTML(post) {
  if (!post.media_url || !/^https?:\/\//.test(post.media_url)) return '';
  const url = esc(post.media_url);
  const guard = post.allow_download ? '' : ' controlsList="nodownload" oncontextmenu="return false"';
  if (post.type === 'video') return `<video class="media" src="${url}" controls${guard} preload="metadata"></video>`;
  if (post.type === 'music') return musicEmbedHTML(post.media_url, post.allow_download)
    .replace('<audio ', `<audio data-mp-title="${esc(post.title || 'Parça')}" data-mp-href="#/read/${encodeURIComponent(post.id)}"${guard} `);
  return `<img class="media" src="${url}" alt="${esc(post.title || '')}" loading="lazy"${post.allow_download ? '' : ' oncontextmenu="return false" draggable="false"'}>`;
}

function musicEmbedHTML(rawUrl, allowDownload) {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'open.spotify.com') {
      const m = u.pathname.match(/^\/(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/);
      if (m) return `<iframe class="music-embed" src="https://open.spotify.com/embed/${m[1]}/${m[2]}" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
    }
    if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtu.be') {
      const vid = host === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v');
      if (vid) return `<iframe class="music-embed music-embed-video" src="https://www.youtube-nocookie.com/embed/${esc(vid)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
    }
    if (host === 'soundcloud.com' || host.endsWith('.soundcloud.com')) {
      return `<iframe class="music-embed" src="https://w.soundcloud.com/player/?url=${encodeURIComponent(rawUrl)}&visual=false" scrolling="no" loading="lazy"></iframe>`;
    }
  } catch {}
  return `<audio class="media" src="${esc(rawUrl)}" controls${allowDownload ? '' : ' controlsList="nodownload" oncontextmenu="return false"'} preload="metadata"></audio>`;
}

async function attachBookCovers(posts) {
  const rows = posts || [];
  const paths = [...new Set(rows.filter(post => post.cover_path).map(post => post.cover_path))];
  if (!paths.length) return rows;
  const { data } = await sb.storage.from('profile-images').createSignedUrls(paths, 3600);
  const urls = Object.fromEntries((data || []).map(item => [item.path, item.signedUrl]));
  return rows.map(post => ({ ...post, cover_signed_url: urls[post.cover_path] || '' }));
}

function postCoverHTML(post) {
  if (!post?.cover_signed_url) return '';
  return `<img class="book-cover-preview visible" src="${esc(post.cover_signed_url)}" alt="${esc(post.title || 'Kitap')} kitap kapağı" loading="lazy">`;
}

let miniPlayerState = { audio: null, bar: null, title: '', href: '' };
function openMiniPlayer(src, title, href) {
  const state = miniPlayerState;
  if (state.audio?.src === src && !state.audio.paused) return;
  if (!state.audio) {
    state.audio = new Audio();
    const bar = document.createElement('div');
    bar.id = 'miniPlayer';
    bar.className = 'mini-player';
    bar.innerHTML = `
      <button class="mp-toggle" type="button" aria-label="Oynat / duraklat">❚❚</button>
      <div class="mp-info"><a class="mp-title" href="${esc(href || '#')}">${esc(title || 'Parça')}</a><span class="mp-time small">0:00</span></div>
      <input class="mp-seek" type="range" min="0" max="1000" value="0" aria-label="Konum">
      <button class="mp-next" type="button" aria-label="Sonraki parça" title="Sonraki parça">⏭</button>
      <button class="mp-close" type="button" aria-label="Kapat">✕</button>`;
    document.body.appendChild(bar);
    state.bar = bar;
    const fmt = s => !isFinite(s) ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const toggle = bar.querySelector('.mp-toggle');
    const timeEl = bar.querySelector('.mp-time');
    const seek = bar.querySelector('.mp-seek');
    const sync = () => {
      timeEl.textContent = `${fmt(state.audio.currentTime)} / ${fmt(state.audio.duration)}`;
      if (state.audio.duration) seek.value = Math.round(state.audio.currentTime / state.audio.duration * 1000);
    };
    state.audio.addEventListener('timeupdate', sync);
    state.audio.addEventListener('ended', () => { if (!playNextInQueue()) closeMiniPlayer(); });
    bar.querySelector('.mp-next').addEventListener('click', playNextInQueue);
    toggle.addEventListener('click', () => { state.audio.paused ? state.audio.play().catch(() => {}) : state.audio.pause(); toggle.textContent = state.audio.paused ? '▶' : '❚❚'; });
    seek.addEventListener('input', () => { if (state.audio.duration) state.audio.currentTime = seek.value / 1000 * state.audio.duration; });
    bar.querySelector('.mp-close').addEventListener('click', closeMiniPlayer);
    document.body.classList.add('has-mini-player');
  }
  state.title = title; state.href = href;
  state.bar.querySelector('.mp-title').textContent = title || 'Parça';
  state.bar.querySelector('.mp-title').href = href || '#';
  state.audio.src = src;
  state.audio.play().catch(() => {});
  state.bar.querySelector('.mp-toggle').textContent = '❚❚';
}
function playNextInQueue() {
  const state = miniPlayerState;
  const els = [...document.querySelectorAll('audio[data-mp-title]')];
  if (!els.length) return false;
  const idx = els.findIndex(el => (el.currentSrc || el.src) === state.audio?.src);
  const next = els[(idx + 1)] || els[0];
  if (!next || (idx === -1 && els.length === 1)) return false;
  openMiniPlayer(next.currentSrc || next.src, next.dataset.mpTitle, next.dataset.mpHref);
  return true;
}

function closeMiniPlayer() {
  const state = miniPlayerState;
  state.audio?.pause();
  state.bar?.remove();
  miniPlayerState = { audio: null, bar: null, title: '', href: '' };
  document.body.classList.remove('has-mini-player');
}
document.addEventListener('play', e => {
  const el = e.target;
  if (el.tagName !== 'AUDIO' || !el.dataset.mpTitle) return;
  el.pause();
  openMiniPlayer(el.currentSrc || el.src, el.dataset.mpTitle, el.dataset.mpHref);
}, true);

function bindRichTextTools(toolbar, textarea) {
  if (!toolbar || !textarea) return;
  toolbar.querySelectorAll('[data-wrap]').forEach(button => button.addEventListener('click', () => {
    const token = button.dataset.wrap;
    const start = textarea.selectionStart, end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end);
    const open = token === '()' ? '(' : '**';
    const close = token === '()' ? ')' : '**';
    textarea.setRangeText(`${open}${selected || 'metin'}${close}`, start, end, 'select');
    const innerStart = start + open.length;
    textarea.setSelectionRange(innerStart, innerStart + (selected || 'metin').length);
    textarea.focus();
  }));
}

function formatBookText(value) {
  return esc(value)
    .replace(/\*\*([^*\n][\s\S]*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\(([^()\n]+)\)/g, '<em>($1)</em>');
}

function renderParagraphs(body, chapterId, counts = {}, kind = null) {
  const paras = String(body || '').split(/\n{2,}|\r?\n/).map(p => p.trim()).filter(Boolean);
  if (!paras.length) return `<div class="para">${esc(body || '')}</div>`;
  const useMarkup = isChapteredKind(kind);
  const isManga = kind === 'manga';
  return paras.map((p, i) => {
    const count = counts[i] || 0;
    const text = useMarkup ? formatBookText(p) : esc(p);
    let cls = '';
    if (isManga) {
      if (/^sayfa\s+\d/i.test(p)) cls = ' manga-page';
      else if (/^panel\s+\d/i.test(p)) cls = ' manga-panel';
      else if (/^sfx\s*:/i.test(p)) cls = ' manga-sfx';
    }
    return `<div class="para${cls}" data-para="${i}" data-chapter="${esc(chapterId)}"><span class="para-text">${text}</span><button class="para-badge" type="button" title="Bu paragrafa yorum" data-para="${i}" data-chapter="${esc(chapterId)}">💬${count ? ` ${count}` : ''}</button></div>`;
  }).join('');
}

function postCard(post, profileMap = {}) {
  const writing = !post.type || post.type === 'writing';
  const kind = quickTypeLabel(post);
  return `
    <article class="card">
      <div class="meta">
        <span>${kind}</span>
        <span>· ${esc(formatDate(post.created_at))}</span>
      </div>
      ${postCoverHTML(post)}
      ${mediaHTML(post)}
      <h3><a href="#/read/${encodeURIComponent(post.id)}">${esc(post.title || 'Başlıksız eser')}</a></h3>
      <div class="post-tags">${hashtagHTML(post)}</div>
      <p>${esc(post.description || '')}</p>
      <div class="meta">${writing ? 'Yazar' : 'Paylaşan'}: ${post.pen_name ? `<span title="Kalem adı">✒️ ${esc(post.pen_name)}</span>` : `<a href="#/user/${encodeURIComponent(post.author_id)}">${esc(displayName(profileMap[post.author_id]))}</a>`}</div>
    </article>`;
}

async function renderSection(key, query) {
  const s = SECTIONS[key];
  if (!s) return renderHome();
  if (key === 'kesfet') return renderDiscover(query);
  if (key === 'topluluklar') return renderCommunities(query);
  const params = new URLSearchParams(query);
  const myHash = location.hash;
  let activeLabel = '';
  const chips = s.groups.flatMap(g => g.items.map(([label, val]) => {
    const on = params.get(g.param) === val;
    const displayLabel = g.param === 'cat' ? `#${tagSlug(label)}` : label;
    if (on) activeLabel = displayLabel;
    return `<a class="chip ${on ? 'on' : ''}" href="${secLink(key, g.param, val)}">${esc(displayLabel)}</a>`;
  }));
  app.innerHTML = `
    <section class="hero" style="padding-bottom:8px">
      <div class="eyebrow">Halka</div>
      <h1>${esc(s.label)}${activeLabel ? ' · ' + esc(activeLabel) : ''}</h1>
    </section>
    <div class="chips"><a class="chip ${activeLabel ? '' : 'on'}" href="${secLink(key)}">Tümü</a>${chips.join('')}</div>
    <div id="sectionFeed">${loadingBlock('Yükleniyor…')}</div>`;

  const makePostsQuery = () => {
    let q = sb.from('posts').select('*').order('created_at', { ascending: false }).limit(60);
    if (s.type && s.type !== 'writing') q = q.eq('type', s.type);
    if (params.get('kind')) q = q.eq('kind', params.get('kind'));
    return q;
  };
  let data, error;
  const selectedTag = params.get('cat') ? tagSlug(params.get('cat')) : '';
  if (selectedTag) {
    const legacyCategory = s.groups.flatMap(g => g.items.map(([label, val]) => [g.param, label, val]))
      .find(([param, , val]) => param === 'cat' && val === selectedTag)?.[1]
      || categories.find(label => tagSlug(label) === selectedTag);
    const queries = [makePostsQuery().contains('tags', [selectedTag])];
    if (legacyCategory) queries.push(makePostsQuery().eq('category', legacyCategory));
    const results = await Promise.all(queries);
    const failure = results.find(result => result.error);
    error = failure?.error || null;
    data = [...new Map(results.flatMap(result => result.data || []).map(post => [post.id, post])).values()]
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).slice(0, 60);
  } else {
    const result = await makePostsQuery();
    data = result.data;
    error = result.error;
  }
  if (location.hash !== myHash) return;
  const box = document.getElementById('sectionFeed');
  if (!box) return;

  if (error) {
    box.innerHTML = `<div class="empty">Eserler yüklenemedi.<br><span class="small">${esc(error.message)}</span></div>`;
    return;
  }
  let posts = data || [];
  if (s.type === 'writing') posts = posts.filter(p => !p.type || p.type === 'writing');
  if (!posts.length) {
    box.innerHTML = '<div class="empty">Burada henüz bir paylaşım yok.<br>İlkini sen yapabilirsin: sağ üstteki + düğmesine dokun.</div>';
    return;
  }
  posts = await attachBookCovers(posts);
  await signPostMedia(posts);
  const ids = [...new Set(posts.map(p => p.author_id).filter(Boolean))];
  const pr = ids.length ? (await sb.from('profiles').select('id,username,display_name').in('id', ids)).data || [] : [];
  if (location.hash !== myHash) return;
  const map = Object.fromEntries(pr.map(x => [x.id, x]));
  box.innerHTML = posts.map(p => postCard(p, map)).join('');
}

function quickTypeLabel(post) {
  return post.type === 'video' ? 'Kısa video' : post.type === 'drawing' ? 'Çizim' : post.type === 'photo' ? 'Fotoğraf' : post.type === 'music' ? 'Müzik' : writingKindLabel(post.kind);
}

function quickVisualHTML(post) {
  if (post.type === 'video' && /^https?:\/\//.test(post.media_url || '')) {
    return `<video class="quick-media" src="${esc(post.media_url)}" muted loop playsinline preload="metadata"${post.allow_download ? '' : ' controlsList="nodownload" oncontextmenu="return false"'}></video><button class="quick-mute" type="button" aria-label="Sesi aç/kapat">🔇</button>`;
  }
  if ((post.type === 'photo' || post.type === 'drawing') && /^https?:\/\//.test(post.media_url || '')) {
    return `<img class="quick-media" src="${esc(post.media_url)}" alt="${esc(post.title || '')}" loading="lazy"${post.allow_download ? '' : ' oncontextmenu="return false" draggable="false"'}>`;
  }
  if (post.type === 'music' && /^https?:\/\//.test(post.media_url || '')) {
    return `<div class="quick-music"><div class="quick-music-note">♪</div>${musicEmbedHTML(post.media_url, post.allow_download)}</div>`;
  }
  if (isChapteredKind(post.kind) || post.cover_signed_url) {
    return `<div class="quick-book">${post.cover_signed_url ? `<img src="${esc(post.cover_signed_url)}" alt="${esc(post.title || 'Kitap')} kapağı">` : '<div class="quick-book-placeholder">Kitap</div>'}<div><span class="eyebrow">Yazarın özeti</span><p>${esc(post.description || 'Yazar bu kitap için henüz bir özet eklememiş.')}</p></div></div>`;
  }
  const writingText = post.quick_body || post.description || post.title || 'Yeni bir eser seni bekliyor.';
  const writingLabel = post.kind === 'short' ? 'Kısa yazının tamamı' : post.kind === 'blog' ? 'Blogdan giriş' : quickTypeLabel(post);
  return `<div class="quick-writing quick-writing-${esc(post.kind || 'default')}"><span class="eyebrow">${esc(writingLabel)}</span><blockquote>${esc(writingText)}</blockquote></div>`;
}

function interleaveQuickPosts(posts) {
  const groups = new Map();
  posts.forEach(post => {
    const key = post.type || 'writing';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(post);
  });
  const queues = [...groups.values()];
  const mixed = [];
  while (queues.some(queue => queue.length)) {
    queues.forEach(queue => { if (queue.length) mixed.push(queue.shift()); });
  }
  return mixed;
}

function bindQuickFeed(feed) {
  const cards = [...feed.querySelectorAll('.quick-card')];
  const counter = document.getElementById('quickCounter');
  let quickMuted = localStorage.getItem('halka_quick_muted') !== '0';
  const applyMute = () => feed.querySelectorAll('video').forEach(v => {
    v.muted = quickMuted;
    const btn = v.closest('.quick-visual')?.querySelector('.quick-mute');
    if (btn) btn.textContent = quickMuted ? '🔇' : '🔊';
  });
  const activate = card => {
    cards.forEach(item => item.querySelector('video')?.pause());
    const video = card.querySelector('video');
    if (video) { video.muted = quickMuted; video.play().catch(() => {}); }
    if (counter) counter.textContent = `${Number(card.dataset.index) + 1} / ${cards.length}`;
  };
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible?.intersectionRatio >= .6) activate(visible.target);
  }, { root: feed, threshold: [.6, .8] });
  cards.forEach(card => observer.observe(card));
  const toggleMute = video => {
    quickMuted = !quickMuted;
    localStorage.setItem('halka_quick_muted', quickMuted ? '1' : '0');
    applyMute();
    video?.play().catch(() => {});
  };
  feed.querySelectorAll('video').forEach(video => {
    video.addEventListener('click', () => toggleMute(video));
    video.closest('.quick-visual')?.querySelector('.quick-mute')?.addEventListener('click', e => {
      e.stopPropagation();
      toggleMute(video);
    });
  });
  applyMute();
  feed.querySelectorAll('.quick-like').forEach(button => button.addEventListener('click', async () => {
    if (!currentUser) { location.hash = '#/auth?signup'; return; }
    const postId = button.dataset.postId;
    const liked = button.classList.contains('liked');
    button.disabled = true;
    const result = liked
      ? await sb.from('likes').delete().eq('post_id', postId).eq('user_id', currentUser.id)
      : await sb.from('likes').insert({ post_id: postId, user_id: currentUser.id });
    button.disabled = false;
    if (result.error) { alert(result.error.message); return; }
    const count = button.querySelector('small');
    count.textContent = String(Math.max(0, Number(count.textContent) + (liked ? -1 : 1)));
    button.classList.toggle('liked', !liked);
    button.setAttribute('aria-pressed', String(!liked));
    button.querySelector('span').textContent = liked ? '♡' : '♥';
  }));
  feed.addEventListener('keydown', event => {
    if (!['ArrowDown','ArrowUp','PageDown','PageUp'].includes(event.key)) return;
    event.preventDefault();
    feed.scrollBy({ top: feed.clientHeight * (event.key === 'ArrowDown' || event.key === 'PageDown' ? 1 : -1), behavior: 'smooth' });
  });
  document.getElementById('quickNext')?.addEventListener('click', () => feed.scrollBy({ top: feed.clientHeight, behavior: 'smooth' }));
  document.getElementById('quickPrev')?.addEventListener('click', () => feed.scrollBy({ top: -feed.clientHeight, behavior: 'smooth' }));
  bindSaveButtons(feed);
}

async function renderDiscover(query = '') {
  const params = new URLSearchParams(query);
  if (params.get('sub') === 'yazarlar') return renderAuthors();
  if (params.get('sub') === 'rastgele') return openRandom();
  const quick = params.get('sub') === 'hizli';
  const themeId = params.get('theme') || '';
  const themeInfo = themeId ? (await sb.from('weekly_themes').select('title').eq('id', themeId).maybeSingle()).data : null;
  const selected = ['video','drawing','photo','writing','music'].includes(params.get('type')) ? params.get('type') : 'all';
  const filters = [['Tümü','all'],['Videolar','video'],['Müzik','music'],['Çizimler','drawing'],['Resimler','photo'],['Yazılar','writing']];
  const linkFor = type => `#/section/kesfet?${quick ? 'sub=hizli&' : ''}${themeId ? `theme=${encodeURIComponent(themeId)}&` : ''}type=${type}`;
  const myHash = location.hash;
  app.innerHTML = `
    <section class="hero" style="padding-bottom:8px"><div class="eyebrow">Halka · Keşfet</div><h1>${quick ? 'Hızlı keşfet' : 'Keşfet'}</h1><p class="subtitle">${quick ? 'Yeni eserleri kaydırarak gözden geçir.' : 'İlham veren yazıları, görselleri, videoları ve müzikleri bul.'}</p></section>
    <div class="discover-switch"><a class="${!quick ? 'on' : ''}" href="#/section/kesfet${themeId ? `?theme=${encodeURIComponent(themeId)}` : ''}">Keşfet sayfası</a><a class="${quick ? 'on' : ''}" href="#/section/kesfet?sub=hizli${themeId ? `&theme=${encodeURIComponent(themeId)}` : ''}">Hızlı keşfet</a></div>
    ${themeInfo ? `<div class="card theme-card" style="margin-bottom:14px"><div class="eyebrow">🎨 Tema filtresi</div><strong>${esc(themeInfo.title || 'Tema')}</strong> <a class="small" href="#/section/kesfet">filtreyi kaldır</a></div>` : ''}
    <div class="chips">${filters.map(([label,type]) => `<a class="chip ${selected === type ? 'on' : ''}" href="${linkFor(type)}">${label}</a>`).join('')}</div>
    <div id="discoverFeed">${loadingBlock('Eserler yükleniyor…')}</div>`;
  let q = sb.from('posts').select('*').order('created_at', { ascending: false }).limit(100);
  if (themeId) q = q.eq('theme_id', themeId);
  if (selected === 'writing') q = q.or('type.eq.writing,type.is.null');
  else if (selected !== 'all') q = q.eq('type', selected);
  const { data, error } = await q;
  if (location.hash !== myHash) return;
  const box = document.getElementById('discoverFeed');
  if (!box) return;
  if (error) { box.innerHTML = `<div class="empty">Keşfet yüklenemedi.<br><span class="small">${esc(error.message)}</span></div>`; return; }
  let posts = data || [];
  if (selected === 'writing') posts = posts.filter(post => !post.type || post.type === 'writing');
  if (!posts.length) { box.innerHTML = '<div class="empty">Bu başlıkta henüz paylaşım yok.</div>'; return; }
  posts = await attachBookCovers(posts);
  await signPostMedia(posts);
  if (quick) {
    const writingIds = posts.filter(post => !post.type || post.type === 'writing').map(post => post.id);
    if (writingIds.length) {
      const chaptersResult = await sb.from('chapters').select('post_id,body,position').in('post_id', writingIds).order('position', { ascending: true });
      const chapterMap = new Map();
      (chaptersResult.data || []).forEach(chapter => {
        if (!chapterMap.has(chapter.post_id)) chapterMap.set(chapter.post_id, []);
        chapterMap.get(chapter.post_id).push(chapter.body || '');
      });
      posts = posts.map(post => {
        const bodies = chapterMap.get(post.id) || [];
        if (post.kind === 'short') return { ...post, quick_body: bodies.filter(Boolean).join('\n\n') || post.description || '' };
        if (post.kind === 'blog') return { ...post, quick_body: (bodies.find(Boolean) || post.description || '').slice(0, 900) };
        return post;
      });
    }
  }
  if (quick && selected === 'all') posts = interleaveQuickPosts(posts);
  if (location.hash !== myHash) return;
  const ids = [...new Set(posts.map(post => post.author_id).filter(Boolean))];
  const result = ids.length ? await sb.from('profiles').select('id,username,display_name').in('id', ids) : { data: [] };
  const profiles = Object.fromEntries((result.data || []).map(profile => [profile.id, profile]));
  if (quick) {
    const postIds = posts.map(post => post.id);
    const [savedResult, likesResult, userLikesResult, commentsResult] = await Promise.all([
      currentUser && postIds.length ? sb.from('saved_posts').select('post_id').eq('user_id', currentUser.id).in('post_id', postIds) : { data: [] },
      postIds.length ? sb.from('likes').select('post_id').in('post_id', postIds) : { data: [] },
      currentUser && postIds.length ? sb.from('likes').select('post_id').eq('user_id', currentUser.id).in('post_id', postIds) : { data: [] },
      postIds.length ? sb.from('comments').select('post_id,author_id,body,created_at').in('post_id', postIds).order('created_at', { ascending: true }) : { data: [] }
    ]);
    const savedPostIds = new Set((savedResult.data || []).map(row => row.post_id));
    const likedPostIds = new Set((userLikesResult.data || []).map(row => row.post_id));
    const likeCounts = {}, commentCounts = {}, commentsByPost = {};
    (likesResult.data || []).forEach(row => { likeCounts[row.post_id] = (likeCounts[row.post_id] || 0) + 1; });
    (commentsResult.data || []).forEach(row => {
      commentCounts[row.post_id] = (commentCounts[row.post_id] || 0) + 1;
      if (!commentsByPost[row.post_id]) commentsByPost[row.post_id] = [];
      commentsByPost[row.post_id].push(row);
    });
    const commentProfilesResult = commentsResult.data?.length ? await sb.from('profiles').select('id,username,display_name').in('id', [...new Set(commentsResult.data.map(c => c.author_id).filter(Boolean))]) : { data: [] };
    const commentProfiles = Object.fromEntries((commentProfilesResult.data || []).map(p => [p.id, p]));
    const quickCommentItem = comment => `<div class="quick-comment"><div class="quick-comment-head"><span class="comment-author">${esc(displayName(commentProfiles[comment.author_id], 'Anonim'))}</span><span class="comment-date">${esc(formatDate(comment.created_at))}</span></div><div class="comment-body">${esc(comment.body)}</div></div>`;
    box.innerHTML = `<section class="quick-shell">
      <div class="quick-progress"><span class="quick-hint">Kaydırarak keşfet</span></div>
      <div class="quick-feed" tabindex="0" aria-label="Hızlı keşfet akışı">${posts.map((post, index) => `<article class="quick-card" data-index="${index}" data-post-id="${esc(post.id)}">
        <div class="quick-visual">${quickVisualHTML(post)}<div class="quick-shade"></div></div>
        <div class="quick-overlay">
          <div class="quick-copy"><div class="quick-kind">${esc(quickTypeLabel(post))} · ${esc(formatDate(post.created_at))}</div><h2>${esc(post.title || 'Başlıksız eser')}</h2><div class="post-tags">${hashtagHTML(post)}</div>${post.type && post.type !== 'writing' ? `<p>${esc((post.description || '').slice(0, 220))}</p>` : ''}${post.pen_name ? `<span class="quick-author" title="Kalem adı">✒️ ${esc(post.pen_name)}</span>` : `<a class="quick-author" href="#/user/${encodeURIComponent(post.author_id)}">@${esc(profiles[post.author_id]?.username || displayName(profiles[post.author_id]))}</a>`}</div>
          <div class="quick-actions"><button class="quick-action quick-like ${likedPostIds.has(post.id) ? 'liked' : ''}" data-post-id="${esc(post.id)}" type="button" aria-label="Beğen" aria-pressed="${likedPostIds.has(post.id)}"><span>${likedPostIds.has(post.id) ? '♥' : '♡'}</span><small>${likeCounts[post.id] || 0}</small></button><button class="quick-action quick-comment-toggle" data-post-id="${esc(post.id)}" type="button" aria-label="Yorumlar"><span>▢</span><small>${commentCounts[post.id] || 0}</small></button>${saveButtonHTML(post.id, savedPostIds.has(post.id))}<a class="quick-action" href="#/chat?share=${encodeURIComponent(post.id)}" title="Sohbette paylaş"><span>✉</span><small>Gönder</small></a><a class="quick-action primary" href="#/read/${encodeURIComponent(post.id)}"><span>↗</span><small>Aç</small></a></div>
        </div>
      </article>`).join('')}</div>
      <div class="quick-controls"><button class="quick-nav" id="quickPrev" type="button" aria-label="Önceki eser">↑</button><button class="quick-nav" id="quickNext" type="button" aria-label="Sonraki eser">↓</button></div>
      <aside class="quick-comments-panel" id="quickCommentsPanel" aria-label="Yorumlar">
        <div class="quick-comments-head"><strong id="quickCommentsTitle">Yorumlar</strong><button class="btn ghost small" id="quickCommentsClose" type="button" aria-label="Yorumları kapat">✕</button></div>
        <div class="quick-comments-list" id="quickCommentsList"></div>
        ${currentUser ? `<form class="quick-comment-form" id="quickCommentForm"><textarea id="quickCommentBody" maxlength="1000" placeholder="Yorumun…" required></textarea><button class="btn primary" type="submit">Gönder</button></form>` : '<div class="small" style="padding:12px;border-top:1px solid var(--line)">Yorum yapmak için <a href="#/auth?login">giriş yap</a>.</div>'}
      </aside>
    </section>`;
    bindQuickFeed(box.querySelector('.quick-feed'));
    let activeQuickPostId = null;
    const panel = document.getElementById('quickCommentsPanel');
    const list = document.getElementById('quickCommentsList');
    const title = document.getElementById('quickCommentsTitle');
    const refreshPanel = postId => {
      activeQuickPostId = postId;
      const post = posts.find(p => p.id === postId);
      title.textContent = post?.title ? 'Yorumlar · ' + post.title.slice(0, 40) : 'Yorumlar';
      const postComments = commentsByPost[postId] || [];
      list.innerHTML = postComments.length ? postComments.map(quickCommentItem).join('') : '<div class="empty" style="padding:92px 10px 20px">Henüz yorum yok.<br>İlk yorumu sen yapabilirsin.</div>';
    };
    const closePanel = () => { panel.classList.remove('open'); activeQuickPostId = null; };
    document.getElementById('quickCommentsClose')?.addEventListener('click', closePanel);
    box.querySelectorAll('.quick-comment-toggle').forEach(btn => btn.addEventListener('click', () => {
      const samePost = activeQuickPostId === btn.dataset.postId;
      if (samePost && panel.classList.contains('open')) { closePanel(); return; }
      refreshPanel(btn.dataset.postId);
      panel.classList.add('open');
      document.getElementById('quickCommentBody')?.focus();
    }));
    document.getElementById('quickCommentForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const bodyEl = document.getElementById('quickCommentBody');
      const body = bodyEl.value.trim();
      if (!activeQuickPostId || !body) return;
      const submit = e.currentTarget.querySelector('button[type="submit"]');
      submit.disabled = true;
      const { data, error } = await sb.from('comments').insert({ post_id: activeQuickPostId, author_id: currentUser.id, body }).select('*').single();
      submit.disabled = false;
      if (error) { alert('Yorum gönderilemedi: ' + error.message); return; }
      if (!commentsByPost[activeQuickPostId]) commentsByPost[activeQuickPostId] = [];
      commentsByPost[activeQuickPostId].push(data);
      bodyEl.value = '';
      refreshPanel(activeQuickPostId);
      panel.classList.add('open');
      const counterButton = box.querySelector(`.quick-comment-toggle[data-post-id="${activeQuickPostId}"] small`);
      if (counterButton) counterButton.textContent = String(commentsByPost[activeQuickPostId].length);
    });
  } else {
    box.innerHTML = `<div class="post-grid">${posts.map(post => postCard(post, profiles)).join('')}</div>`;
  }
}

async function renderAuthors() {
  const myHash = location.hash;
  app.innerHTML = `
    <section class="hero" style="padding-bottom:8px"><div class="eyebrow">Keşfet</div><h1>Yazarlar</h1></section>
    <div id="authors">${loadingBlock('Yazarlar yükleniyor…')}</div>`;
  const { data, error } = await sb.from('profiles').select('id,username,display_name,profile_visibility').eq('profile_visibility', 'public').limit(60);
  if (location.hash !== myHash) return;
  const box = document.getElementById('authors');
  if (!box) return;
  if (error) { box.innerHTML = `<div class="empty">Yazarlar yüklenemedi.<br><span class="small">${esc(error.message)}</span></div>`; return; }
  if (!(data || []).length) { box.innerHTML = '<div class="empty">Henüz kimse katılmamış.</div>'; return; }
  box.innerHTML = data.map(p => `
    <a class="card" href="#/user/${encodeURIComponent(p.id)}" style="display:flex;gap:14px;align-items:center">
      <div class="avatar">${initials(displayName(p))}</div>
      <div><h3 style="margin:0">${esc(displayName(p))}</h3><div class="meta">@${esc(p.username || '')}</div></div>
    </a>`).join('');
}

async function openRandom() {
  app.innerHTML = loadingBlock('Bir eser seçiliyor…');
  const { data } = await sb.from('posts').select('id').limit(200);
  if (!data || !data.length) { app.innerHTML = '<div class="empty">Henüz açılacak bir eser yok.</div>'; return; }
  location.hash = '#/read/' + encodeURIComponent(data[Math.floor(Math.random() * data.length)].id);
}

function renderCreate(type, mode) {
  if (!currentUser) { location.hash = '#/auth?signup'; return; }
  if (type === 'music') return renderCreateMusic(mode || 'file');
  if (['drawing', 'photo', 'video'].includes(type)) return renderCreateMedia(type, mode);
  location.hash = '#/';
}

let activeCameraStream = null;
function stopCameraStream() {
  if (!activeCameraStream) return;
  activeCameraStream.getTracks().forEach(t => t.stop());
  activeCameraStream = null;
}

const MEDIA_CREATE = {
  drawing: { label: 'Çizim', folder: 'drawings', accept: 'image/jpeg,image/png,image/webp,image/gif', maxMB: 15, modes: { canvas: 'Tuvalde çiz', file: 'Dosya yükle' } },
  photo: { label: 'Fotoğraf', folder: 'photos', accept: 'image/jpeg,image/png,image/webp,image/gif', maxMB: 15, modes: { camera: 'Kamerayla çek', file: 'Dosya yükle' } },
  video: { label: 'Video', folder: 'videos', accept: 'video/mp4,video/webm,video/quicktime', maxMB: 45, modes: { camera: 'Kamerayla kaydet', file: 'Dosya yükle' } }
};

const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const VIDEO_EXT = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };

async function publishMediaPost({ type, file, mime, title, tags, description, pen_name, critique_wanted, allow_download }) {
  const cfg = MEDIA_CREATE[type];
  mime = String(mime || '').split(';')[0].trim();
  if (/^image\//.test(mime)) {
    const compressed = await compressImage(file, 1920);
    if (compressed !== file) { file = compressed; mime = 'image/webp'; }
  }
  const ext = ({ ...IMAGE_EXT, ...VIDEO_EXT })[mime] || mime.split('/')[1] || 'bin';
  const path = `${currentUser.id}/${cfg.folder}/${crypto.randomUUID()}.${ext}`;
  const upload = await sb.storage.from('post-media').upload(path, file, { contentType: mime, upsert: false });
  if (upload.error) throw new Error('Dosya yüklenemedi: ' + upload.error.message);
  const mediaUrl = sb.storage.from('post-media').getPublicUrl(path).data.publicUrl;
  const { data: post, error } = await sb.from('posts').insert({
    author_id: currentUser.id, title, description, tags,
    category: tags[0] || 'Diğer', type, kind: type, media_url: mediaUrl,
    pen_name: pen_name || null, critique_wanted: !!critique_wanted, allow_download: !!allow_download
  }).select().single();
  if (error) { await sb.storage.from('post-media').remove([path]); throw new Error('Eser oluşturulamadı: ' + error.message); }
  return post;
}

function mediaPostFormHTML(idPrefix) {
  return `
    <div class="field"><label for="${idPrefix}Title">Eserin adı</label><input id="${idPrefix}Title" name="title" required maxlength="120" placeholder="Eserinin adı"></div>
    <div class="field"><label for="${idPrefix}PenName">Kalem adı <span class="small">(isteğe bağlı)</span></label><input id="${idPrefix}PenName" name="pen_name" maxlength="60" placeholder="Boş bırakırsan profil adın görünür"><div class="small">Bu eserde profil adın yerine bu isim gösterilir.</div></div>
    <div class="field" style="display:flex;align-items:center;gap:8px"><input id="${idPrefix}Critique" name="critique_wanted" type="checkbox" style="width:auto"><label for="${idPrefix}Critique" style="margin:0">🎯 Bu esere eleştiri istiyorum</label></div>
    <div class="field" style="display:flex;align-items:center;gap:8px"><input id="${idPrefix}Download" name="allow_download" type="checkbox" style="width:auto"><label for="${idPrefix}Download" style="margin:0">⬇️ Bu eserin indirilmesine izin ver</label></div>
    <div class="field"><label for="${idPrefix}Tags">Hashtag'ler</label><input id="${idPrefix}Tags" name="tags" maxlength="160" placeholder="çizim, portre"><div class="small">Virgül veya boşlukla ayır; en fazla 5 hashtag.</div><div id="${idPrefix}TagPreview" class="post-tags" aria-live="polite"></div></div>
    <div class="field"><label for="${idPrefix}Desc">Kısa tanıtım</label><textarea id="${idPrefix}Desc" name="description" maxlength="1200" placeholder="Eserin hakkında birkaç cümle…"></textarea></div>`;
}

function bindMediaTagsPreview(idPrefix) {
  document.getElementById(`${idPrefix}Tags`).addEventListener('input', e => {
    const tags = parseHashtags(e.target.value);
    document.getElementById(`${idPrefix}TagPreview`).innerHTML = tags.map(tag => `<span class="hashtag">#${esc(tag)}</span>`).join('');
  });
}

function renderCreateMedia(type, mode) {
  const cfg = MEDIA_CREATE[type];
  const modeKey = cfg.modes[mode] ? mode : Object.keys(cfg.modes)[0];
  const isVideo = type === 'video';
  const isDrawing = type === 'drawing';
  const captureLabel = { canvas: 'Tuvalde çiz', camera: 'Kamerayla ' + (isVideo ? 'kaydet' : 'çek'), file: 'Dosya yükle' }[modeKey];

  app.innerHTML = `
    <section class="hero">
      <div class="eyebrow">${cfg.label} paylaş</div>
      <h1>${esc(captureLabel)}.</h1>
      <p class="subtitle">${isDrawing ? 'Tuvalde çiz veya hazır görselini yükle.' : isVideo ? 'Kamerayla kaydet veya video dosyası yükle.' : 'Kamerayla çek veya galeriden seç.'}</p>
    </section>
    <div class="chips">${Object.entries(cfg.modes).map(([key, label]) => `<a class="chip ${key === modeKey ? 'on' : ''}" href="#/create/${type}?mode=${key}">${label}</a>`).join('')}</div>
    <section class="card">
      <form id="mediaForm">
        ${mediaPostFormHTML('media')}
        ${modeKey === 'file' ? `
        <div class="field">
          <label for="mediaFile">${cfg.label} dosyası</label>
          <input id="mediaFile" type="file" accept="${cfg.accept}">
          <div class="small">En fazla ${cfg.maxMB} MB</div>
          ${isVideo ? '<video id="mediaFilePreview" controls hidden style="width:100%;margin-top:10px;border-radius:12px"></video>' : '<img id="mediaFilePreview" class="book-cover-preview" alt="Önizleme">'}
        </div>` : ''}
        ${modeKey === 'canvas' ? `
        <div class="field">
          <label>Tuval</label>
          <div class="canvas-tools">
            <div class="canvas-tool-row"><label class="small">Fırça rengi</label><div class="color-row" id="brushColors"></div><input type="color" id="brushCustom" class="color-custom" value="#111111" title="İstediğin rengi seç"></div>
            <div class="canvas-tool-row">
              <label class="small">Araç</label>
              <button class="btn ghost small canvas-tool on" data-tool="pen" type="button">Kalem</button>
              <button class="btn ghost small canvas-tool" data-tool="marker" type="button">Fosforlu</button>
              <button class="btn ghost small canvas-tool" data-tool="eraser" type="button">Silgi</button>
              <button class="btn ghost small canvas-tool" data-tool="line" type="button">Çizgi</button>
              <button class="btn ghost small canvas-tool" data-tool="rect" type="button">Dikdörtgen</button>
              <button class="btn ghost small canvas-tool" data-tool="ellipse" type="button">Elips</button>
              <button class="btn ghost small canvas-tool" data-tool="fill" type="button">Dolgu</button>
            </div>
            <div class="canvas-tool-row">
              <label class="small">Boyut <input type="range" id="brushSize" min="1" max="40" value="6"></label>
              <label class="small">Opaklık <input type="range" id="brushOpacity" min="5" max="100" value="100"></label>
              <button class="btn ghost small" id="canvasUndo" type="button">Geri al</button>
              <button class="btn ghost small" id="canvasRedo" type="button">İleri al</button>
              <button class="btn ghost small" id="canvasClear" type="button">Temizle</button>
            </div>
            <div class="canvas-tool-row"><label class="small">Zemin</label><div class="color-row" id="bgColors"></div><input type="color" id="bgCustom" class="color-custom" value="#f4f0e8" title="Zemin rengi seç"></div>
          </div>
          <canvas id="drawCanvas" class="draw-canvas" width="1200" height="800"></canvas>
        </div>` : ''}
        ${modeKey === 'camera' ? `
        <div class="field">
          <label>Kamera</label>
          <video id="cameraView" class="camera-view" autoplay playsinline muted ${isVideo ? '' : ''}></video>
          <img id="cameraStill" class="camera-view" alt="Çekilen fotoğraf" hidden>
          <video id="cameraPlayback" class="camera-view" controls hidden></video>
          <div class="record-tools" style="margin-top:10px">
            <button class="btn" id="cameraStart" type="button">Kamerayı aç</button>
            <button class="btn primary" id="cameraCapture" type="button" hidden>${isVideo ? '● Kaydı başlat' : 'Çek'}</button>
            <button class="btn" id="cameraStop" type="button" hidden>Kaydı durdur</button>
            <button class="btn ghost" id="cameraRetake" type="button" hidden>Yeniden ${isVideo ? 'kaydet' : 'çek'}</button>
            <span class="small" id="cameraStatus">Kamera izni istenecek.</span>
          </div>
        </div>` : ''}
        <button class="btn primary" type="submit">${cfg.label} yayımla</button>
      </form>
      <div id="message" class="message"></div>
    </section>`;

  bindMediaTagsPreview('media');
  stopCameraStream();
  let capturedBlob = null;
  let capturedMime = null;

  const fileInput = document.getElementById('mediaFile');
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      const preview = document.getElementById('mediaFilePreview');
      if (!file) { preview.hidden = true; return; }
      if (file.size > cfg.maxMB * 1024 * 1024) {
        fileInput.value = '';
        preview.hidden = true;
        return showMessage(`Dosya ${cfg.maxMB} MB sınırını aşmamalı.`, true);
      }
      preview.src = URL.createObjectURL(file);
      preview.hidden = false;
      preview.classList.add('visible');
      markDraftDirty(type);
    });
  }

  document.getElementById('mediaForm').addEventListener('input', () => markDraftDirty(type));

  // ---- Tuval modu ----
  const canvas = document.getElementById('drawCanvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    const brushPalette = ['#111111', '#f4f0e8', '#7C5CFF', '#4CAF7D', '#E8923C', '#E5484D', '#378ADD', '#D4537E', '#d9b978'];
    const bgPalette = ['#f4f0e8', '#ffffff', '#1b1b18', '#2a2417'];
    let brushColor = '#111111';
    let bgColor = '#f4f0e8';
    let tool = 'pen';
    let drawing = false;
    let startPoint = null;
    let snapshot = null;
    const undoStack = [];
    const redoStack = [];
    const pushUndo = () => {
      undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      if (undoStack.length > 30) undoStack.shift();
      redoStack.length = 0;
    };
    const paintBg = () => { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, canvas.width, canvas.height); };
    paintBg();

    const buildSwatches = (containerId, colors, onPick, selected) => {
      const box = document.getElementById(containerId);
      box.innerHTML = colors.map(c => `<label class="color-dot"><input type="radio" name="${containerId}" value="${c}" ${c === selected ? 'checked' : ''}><span style="background:${c};border-color:#555"></span></label>`).join('');
      box.querySelectorAll('input').forEach(r => r.addEventListener('change', () => onPick(r.value)));
    };
    const pickBrush = c => { brushColor = c; if (tool === 'eraser') setTool('pen'); };
    const pickBg = c => { pushUndo(); bgColor = c; paintBg(); };
    buildSwatches('brushColors', brushPalette, pickBrush, brushColor);
    buildSwatches('bgColors', bgPalette, pickBg, bgColor);
    document.getElementById('brushCustom').addEventListener('input', e => { pickBrush(e.target.value); document.querySelectorAll('#brushColors input').forEach(r => r.checked = false); });
    document.getElementById('bgCustom').addEventListener('change', e => { pickBg(e.target.value); document.querySelectorAll('#bgColors input').forEach(r => r.checked = false); });

    const setTool = t => {
      tool = t;
      document.querySelectorAll('.canvas-tool').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
    };
    document.querySelectorAll('.canvas-tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

    const pos = e => {
      const r = canvas.getBoundingClientRect();
      const p = e.touches ? e.touches[0] : e;
      return { x: (p.clientX - r.left) * (canvas.width / r.width), y: (p.clientY - r.top) * (canvas.height / r.height) };
    };
    const hexToRgba = (hex, alpha) => {
      const n = parseInt(hex.slice(1), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
    };
    const styleFor = () => {
      const opacity = Number(document.getElementById('brushOpacity').value) / 100;
      const size = Number(document.getElementById('brushSize').value);
      if (tool === 'eraser') return { color: bgColor, size, alpha: 1 };
      if (tool === 'marker') return { color: brushColor, size: Math.max(size * 2.5, 12), alpha: opacity * 0.35 };
      return { color: brushColor, size, alpha: opacity };
    };
    const applyStroke = () => {
      const s = styleFor();
      ctx.lineWidth = s.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = hexToRgba(s.color, s.alpha);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.globalAlpha = s.alpha;
    };
    const floodFill = (sx, sy) => {
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = img.data;
      const w = canvas.width, h = canvas.height;
      const s = Math.round(sx), t = Math.round(sy);
      if (s < 0 || s >= w || t < 0 || t >= h) return;
      const idx = (t * w + s) * 4;
      const tr = d[idx], tg = d[idx + 1], tb = d[idx + 2], ta = d[idx + 3];
      const n = parseInt(brushColor.slice(1), 16);
      const fr = (n >> 16) & 255, fg = (n >> 8) & 255, fb = n & 255;
      if (tr === fr && tg === fg && tb === fb && ta === 255) return;
      const match = i => d[i] === tr && d[i + 1] === tg && d[i + 2] === tb && d[i + 3] === ta;
      const stack = [[s, t]];
      const seen = new Uint8Array(w * h);
      while (stack.length) {
        const [x, y] = stack.pop();
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        const p = y * w + x;
        if (seen[p]) continue;
        const i = p * 4;
        if (!match(i)) continue;
        seen[p] = 1;
        d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = 255;
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      ctx.putImageData(img, 0, 0);
    };
    const drawShape = (from, to, live) => {
      if (live && snapshot) ctx.putImageData(snapshot, 0, 0);
      applyStroke();
      ctx.beginPath();
      if (tool === 'line') { ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); }
      else if (tool === 'rect') ctx.rect(Math.min(from.x, to.x), Math.min(from.y, to.y), Math.abs(to.x - from.x), Math.abs(to.y - from.y));
      else if (tool === 'ellipse') ctx.ellipse((from.x + to.x) / 2, (from.y + to.y) / 2, Math.abs(to.x - from.x) / 2, Math.abs(to.y - from.y) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    const start = e => {
      e.preventDefault();
      markDraftDirty('drawing');
      const p = pos(e);
      if (tool === 'fill') { pushUndo(); floodFill(p.x, p.y); return; }
      drawing = true;
      pushUndo();
      startPoint = p;
      if (['line', 'rect', 'ellipse'].includes(tool)) {
        snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } else {
        applyStroke();
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + 0.01, p.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
      }
    };
    const move = e => {
      if (!drawing) return;
      e.preventDefault();
      const p = pos(e);
      if (['line', 'rect', 'ellipse'].includes(tool)) { drawShape(startPoint, p, true); return; }
      applyStroke();
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    const end = e => {
      if (!drawing) return;
      drawing = false;
      if (['line', 'rect', 'ellipse'].includes(tool) && startPoint) {
        const p = e ? pos(e) : startPoint;
        drawShape(startPoint, p, false);
      }
      snapshot = null;
      startPoint = null;
      ctx.globalAlpha = 1;
    };
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);

    document.getElementById('canvasUndo').addEventListener('click', () => {
      const img = undoStack.pop();
      if (!img) return;
      redoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      ctx.putImageData(img, 0, 0);
    });
    document.getElementById('canvasRedo').addEventListener('click', () => {
      const img = redoStack.pop();
      if (!img) return;
      undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      ctx.putImageData(img, 0, 0);
    });
    document.getElementById('canvasClear').addEventListener('click', () => { pushUndo(); paintBg(); });
  }

  // ---- Kamera modu ----
  const camStart = document.getElementById('cameraStart');
  if (camStart) {
    const view = document.getElementById('cameraView');
    const still = document.getElementById('cameraStill');
    const playback = document.getElementById('cameraPlayback');
    const capture = document.getElementById('cameraCapture');
    const stop = document.getElementById('cameraStop');
    const retake = document.getElementById('cameraRetake');
    const status = document.getElementById('cameraStatus');
    let recorder = null;

    camStart.addEventListener('click', async () => {
      try {
        activeCameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: isVideo });
        view.srcObject = activeCameraStream;
        view.hidden = false;
        camStart.hidden = true;
        capture.hidden = false;
        status.textContent = isVideo ? 'Kayda hazır.' : 'Kadrajı ayarla ve Çek düğmesine bas.';
      } catch (err) {
        status.textContent = 'Kamera izni alınamadı veya kamera yok.';
      }
    });

    if (!isVideo) {
      capture.addEventListener('click', () => {
        markDraftDirty('photo');
        const c = document.createElement('canvas');
        c.width = view.videoWidth || 1280;
        c.height = view.videoHeight || 720;
        c.getContext('2d').drawImage(view, 0, 0);
        capturedMime = 'image/jpeg';
        c.toBlob(blob => {
          capturedBlob = blob;
          still.src = URL.createObjectURL(blob);
          still.hidden = false;
          view.hidden = true;
          capture.hidden = true;
          retake.hidden = false;
          stopCameraStream();
          status.textContent = 'Fotoğraf çekildi — beğenmediysen yeniden çekebilirsin.';
        }, 'image/jpeg', 0.92);
      });
    } else {
      capture.addEventListener('click', () => {
        if (!activeCameraStream) return;
        markDraftDirty('video');
        const chunks = [];
        recorder = new MediaRecorder(activeCameraStream);
        recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
        recorder.onstop = () => {
          capturedMime = recorder.mimeType || 'video/webm';
          capturedBlob = new Blob(chunks, { type: capturedMime });
          playback.src = URL.createObjectURL(capturedBlob);
          playback.hidden = false;
          view.hidden = true;
          stopCameraStream();
          capture.hidden = true;
          stop.hidden = true;
          retake.hidden = false;
          status.textContent = 'Kayıt hazır — izleyip yayımlayabilir veya yeniden kaydedebilirsin.';
        };
        recorder.start();
        capture.hidden = true;
        stop.hidden = false;
        status.textContent = 'Kayıt yapılıyor…';
      });
      stop.addEventListener('click', () => recorder?.stop());
    }

    retake.addEventListener('click', () => {
      capturedBlob = null;
      capturedMime = null;
      still.hidden = true;
      playback.hidden = true;
      retake.hidden = true;
      camStart.hidden = false;
      camStart.click();
    });
  }

  document.getElementById('mediaForm').addEventListener('submit', async e => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const title = String(form.get('title') || '').trim();
    const description = String(form.get('description') || '').trim();
    const tags = parseHashtags(form.get('tags'));
    const submit = e.currentTarget.querySelector('button[type="submit"]');
    if (!title) { showMessage('Lütfen eserine bir ad ver.', true); return; }
    submit.disabled = true;
    submit.textContent = 'Yayımlanıyor…';
    try {
      let file = null;
      let mime = null;
      if (modeKey === 'file') {
        file = fileInput?.files?.[0];
        if (!file) { showMessage('Önce bir dosya seç.', true); return; }
        mime = file.type;
      } else if (modeKey === 'canvas') {
        mime = 'image/png';
        file = await new Promise(res => canvas.toBlob(res, 'image/png'));
      } else {
        if (!capturedBlob) { showMessage(isVideo ? 'Önce bir kayıt yap.' : 'Önce bir fotoğraf çek.', true); return; }
        file = capturedBlob;
        mime = capturedMime;
      }
      if (file.size > cfg.maxMB * 1024 * 1024) { showMessage(`Dosya ${cfg.maxMB} MB sınırını aşmamalı.`, true); return; }
      const post = await publishMediaPost({ type, file, mime, title, tags, description,
        pen_name: String(form.get('pen_name') || '').trim().slice(0, 60) || null,
        critique_wanted: form.get('critique_wanted') === 'on',
        allow_download: form.get('allow_download') === 'on' });
      stopCameraStream();
      clearDraft();
      location.hash = '#/read/' + encodeURIComponent(post.id);
    } catch (err) {
      showMessage(err.message || 'Bir hata oluştu.', true);
    } finally {
      submit.disabled = false;
      submit.textContent = `${cfg.label} yayımla`;
    }
  });
}

const MUSIC_MODES = {
  file: 'Ses dosyası yükle',
  record: 'Kayıt yap',
  link: 'Bağlantı ekle'
};

function renderCreateMusic(mode) {
  const modeKey = MUSIC_MODES[mode] ? mode : 'file';
  app.innerHTML = `
    <section class="hero">
      <div class="eyebrow">Müzik paylaş</div>
      <h1>${esc(MUSIC_MODES[modeKey])}.</h1>
      <p class="subtitle">Besteni, kaydını veya beğendiğin bir bağlantıyı Halka'da paylaş.</p>
    </section>
    <div class="chips">${Object.entries(MUSIC_MODES).map(([key, label]) => `<a class="chip ${key === modeKey ? 'on' : ''}" href="#/create/music?mode=${key}">${label}</a>`).join('')}</div>
    <section class="card">
      <form id="musicForm">
        <div class="field">
          <label for="musicTitle">Eserin adı</label>
          <input id="musicTitle" name="title" required maxlength="120" placeholder="Parçanın adı">
        </div>
        <div class="field">
          <label for="musicPenName">Kalem adı <span class="small">(isteğe bağlı)</span></label>
          <input id="musicPenName" name="pen_name" maxlength="60" placeholder="Boş bırakırsan profil adın görünür">
          <div class="small">Bu eserde profil adın yerine bu isim gösterilir.</div>
        </div>
        <div class="field" style="display:flex;align-items:center;gap:8px">
          <input id="musicCritique" name="critique_wanted" type="checkbox" style="width:auto">
          <label for="musicCritique" style="margin:0">🎯 Bu esere eleştiri istiyorum</label>
        </div>
        <div class="field" style="display:flex;align-items:center;gap:8px">
          <input id="musicDownload" name="allow_download" type="checkbox" style="width:auto">
          <label for="musicDownload" style="margin:0">⬇️ Bu eserin indirilmesine izin ver</label>
        </div>
        <div class="field">
          <label for="musicTags">Hashtag'ler</label>
          <input id="musicTags" name="tags" maxlength="160" placeholder="pop, akustik, cover">
          <div class="small">Virgül veya boşlukla ayır; en fazla 5 hashtag. Örnek: #pop #akustik</div>
          <div id="musicTagPreview" class="post-tags" aria-live="polite"></div>
        </div>
        <div class="field">
          <label for="musicDesc">Kısa tanıtım</label>
          <textarea id="musicDesc" name="description" maxlength="1200" placeholder="Parçan hakkında birkaç cümle…"></textarea>
        </div>
        <div class="field">
          <label for="musicCover">Albüm kapağı (isteğe bağlı)</label>
          <input id="musicCover" type="file" accept="image/jpeg,image/png,image/webp">
          <div class="small">JPG, PNG veya WebP · en fazla 5 MB</div>
          <img id="musicCoverPreview" class="book-cover-preview" alt="Albüm kapağı önizlemesi">
        </div>
        ${modeKey === 'file' ? `
        <div class="field">
          <label for="musicFile">Ses dosyası</label>
          <input id="musicFile" type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.aac,.webm">
          <div class="small">MP3, WAV, OGG, M4A, FLAC · en fazla 30 MB</div>
          <audio id="musicFilePreview" controls hidden style="width:100%;margin-top:10px"></audio>
        </div>` : ''}
        ${modeKey === 'record' ? `
        <div class="field">
          <label>Mikrofon kaydı</label>
          <div class="record-tools">
            <button class="btn" id="musicRecStart" type="button">● Kaydı başlat</button>
            <button class="btn ghost" id="musicRecStop" type="button" disabled>Durdur</button>
            <span class="small" id="musicRecStatus">Kayıt için mikrofon izni istenecek.</span>
          </div>
          <audio id="musicRecPreview" controls hidden style="width:100%;margin-top:10px"></audio>
        </div>` : ''}
        ${modeKey === 'link' ? `
        <div class="field">
          <label for="musicLink">Bağlantı</label>
          <input id="musicLink" name="link" type="url" required maxlength="500" placeholder="https://open.spotify.com/track/…">
          <div class="small">Spotify, YouTube / YouTube Music, SoundCloud bağlantısı veya doğrudan ses dosyası adresi.</div>
        </div>` : ''}
        <button class="btn primary" type="submit">Parçayı yayımla</button>
      </form>
      <div id="message" class="message"></div>
    </section>`;

  document.getElementById('musicTags').addEventListener('input', e => {
    const tags = parseHashtags(e.target.value);
    document.getElementById('musicTagPreview').innerHTML = tags.map(tag => `<span class="hashtag">#${esc(tag)}</span>`).join('');
  });
  document.getElementById('musicForm').addEventListener('input', () => markDraftDirty('music'));

  document.getElementById('musicCover').addEventListener('change', event => {
    const file = event.currentTarget.files?.[0];
    const preview = document.getElementById('musicCoverPreview');
    if (!file) { preview.classList.remove('visible'); preview.removeAttribute('src'); return; }
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      event.currentTarget.value = '';
      preview.classList.remove('visible');
      return showMessage('Kapak JPG, PNG veya WebP olmalı ve 5 MB sınırını aşmamalı.', true);
    }
    preview.src = URL.createObjectURL(file);
    preview.classList.add('visible');
  });

  let recordedBlob = null;
  let recorder = null;
  const recPreview = document.getElementById('musicRecPreview');
  const fileInput = document.getElementById('musicFile');
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      const preview = document.getElementById('musicFilePreview');
      if (!file) { preview.hidden = true; return; }
      if (!file.type.startsWith('audio/') || file.size > 30 * 1024 * 1024) {
        fileInput.value = '';
        preview.hidden = true;
        return showMessage('Ses dosyası 30 MB sınırını aşmamalı ve ses formatında olmalı.', true);
      }
      preview.src = URL.createObjectURL(file);
      preview.hidden = false;
      markDraftDirty('music');
    });
  }
  const recStart = document.getElementById('musicRecStart');
  const recStop = document.getElementById('musicRecStop');
  const recStatus = document.getElementById('musicRecStatus');
  if (recStart && recStop) {
    recStart.addEventListener('click', async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        markDraftDirty('music');
        const chunks = [];
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
        recorder.onstop = () => {
          stream.getTracks().forEach(t => t.stop());
          recordedBlob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          recPreview.src = URL.createObjectURL(recordedBlob);
          recPreview.hidden = false;
          recStatus.textContent = 'Kayıt hazır — dinleyip yayımlayabilir veya yeniden kaydedebilirsin.';
          recStart.disabled = false;
          recStop.disabled = true;
        };
        recorder.start();
        recordedBlob = null;
        recPreview.hidden = true;
        recStatus.textContent = 'Kayıt yapılıyor…';
        recStart.disabled = true;
        recStop.disabled = false;
      } catch (err) {
        recStatus.textContent = 'Mikrofon izni alınamadı veya kayıt desteklenmiyor.';
      }
    });
    recStop.addEventListener('click', () => recorder?.stop());
  }

  document.getElementById('musicForm').addEventListener('submit', async e => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const title = String(form.get('title') || '').trim();
    const description = String(form.get('description') || '').trim();
    const tags = parseHashtags(form.get('tags'));
    const submit = e.currentTarget.querySelector('button[type="submit"]');
    if (!title) { showMessage('Lütfen parçana bir ad ver.', true); return; }
    submit.disabled = true;
    submit.textContent = 'Yayımlanıyor…';
    try {
      let mediaUrl = '';
      if (modeKey === 'link') {
        mediaUrl = String(form.get('link') || '').trim();
        if (!/^https?:\/\//.test(mediaUrl)) { showMessage('Geçerli bir bağlantı gir (https://…)', true); return; }
      } else {
        const file = modeKey === 'file' ? fileInput?.files?.[0] : recordedBlob;
        if (!file) { showMessage(modeKey === 'file' ? 'Önce bir ses dosyası seç.' : 'Önce bir kayıt yap.', true); return; }
        if (file.size > 30 * 1024 * 1024) { showMessage('Ses dosyası 30 MB sınırını aşmamalı.', true); return; }
        const mime = (file.type || 'audio/webm').split(';')[0].trim();
        const ext = ({ 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/flac': 'flac', 'audio/aac': 'aac', 'audio/webm': 'webm' })[mime] || 'webm';
        const path = `${currentUser.id}/music/${crypto.randomUUID()}.${ext}`;
        const upload = await sb.storage.from('post-media').upload(path, file, { contentType: mime, upsert: false });
        if (upload.error) { showMessage('Ses yüklenemedi: ' + upload.error.message, true); return; }
        mediaUrl = sb.storage.from('post-media').getPublicUrl(path).data.publicUrl;
      }
      let coverPath = null;
      let coverFile = document.getElementById('musicCover')?.files?.[0];
      if (coverFile) {
        const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[coverFile.type];
        if (!extension || coverFile.size > 5 * 1024 * 1024) { showMessage('Kapak JPG, PNG veya WebP olmalı ve 5 MB sınırını aşmamalı.', true); return; }
        coverFile = await compressImage(coverFile, 1280);
        coverPath = `${currentUser.id}/music-covers/${crypto.randomUUID()}.${coverFile.type === 'image/webp' ? 'webp' : extension}`;
        const coverUpload = await sb.storage.from('profile-images').upload(coverPath, coverFile, { contentType: coverFile.type, upsert: false });
        if (coverUpload.error) { showMessage('Kapak yüklenemedi: ' + coverUpload.error.message, true); return; }
      }
      const { data: post, error } = await sb.from('posts').insert({
        author_id: currentUser.id,
        title,
        description,
        tags,
        category: tags[0] || 'Diğer',
        type: 'music',
        kind: 'music',
        media_url: mediaUrl,
        pen_name: String(form.get('pen_name') || '').trim().slice(0, 60) || null,
        critique_wanted: form.get('critique_wanted') === 'on',
        allow_download: form.get('allow_download') === 'on',
        ...(coverPath ? { cover_path: coverPath } : {})
      }).select().single();
      if (error) { showMessage('Parça oluşturulamadı: ' + error.message, true); return; }
      clearDraft();
      location.hash = '#/read/' + encodeURIComponent(post.id);
    } catch (err) {
      showMessage(err.message || 'Bir hata oluştu.', true);
    } finally {
      submit.disabled = false;
      submit.textContent = 'Parçayı yayımla';
    }
  });
}

const COMMUNITY_COLORS = ['#7C5CFF', '#4CAF7D', '#E8923C', '#E5484D', '#378ADD', '#D4537E'];

async function renderCommunities(query = '') {
  const sub = new URLSearchParams(query).get('sub');
  const myHash = location.hash;

  if (sub === 'yeni') {
    if (!currentUser) { location.hash = '#/auth?signup'; return; }
    app.innerHTML = `
      <section class="hero"><div class="eyebrow">Topluluklar</div><h1>Topluluk kur.</h1><p class="subtitle">Kendi halkanü oluştur: üyeler katılır, topluluk sohbetinde eserler ve dosyalar paylaşılır.</p></section>
      <section class="card">
        <form id="communityForm">
          <div class="field"><label for="cname">Topluluk adı</label><input id="cname" name="name" required maxlength="60" placeholder="Örn. Gece Yazarları"></div>
          <div class="field"><label for="cdesc">Tanıtım</label><textarea id="cdesc" name="description" maxlength="1200" placeholder="Bu topluluk ne hakkında? Kimler katılmalı?"></textarea></div>
          <div class="field"><label>Renk</label><div class="color-row">${COMMUNITY_COLORS.map((c, i) => `<label class="color-dot"><input type="radio" name="color" value="${c}" ${i === 5 ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div></div>
          <div class="field"><label>Kimler katılabilir?</label>
            <div class="policy-row">
              <label class="policy-opt"><input type="radio" name="join_policy" value="open" checked><span><strong>Herkes</strong><br><span class="small">İsteyen herkes anında katılır</span></span></label>
              <label class="policy-opt"><input type="radio" name="join_policy" value="approval"><span><strong>İstek onayı</strong><br><span class="small">Üyeler istek gönderir, yönetici onaylar</span></span></label>
              <label class="policy-opt"><input type="radio" name="join_policy" value="invite"><span><strong>Sadece davet</strong><br><span class="small">Yalnızca yönetici davetiyle girilir</span></span></label>
            </div>
          </div>
          <button class="btn primary" type="submit">Topluluğu kur</button>
        </form>
        <div id="message" class="message"></div>
      </section>`;
    document.getElementById('communityForm').addEventListener('submit', async e => {
      e.preventDefault();
      const form = new FormData(e.currentTarget);
      const name = String(form.get('name') || '').trim();
      const description = String(form.get('description') || '').trim();
      const color = String(form.get('color') || COMMUNITY_COLORS[5]);
      const submit = e.currentTarget.querySelector('button[type="submit"]');
      if (name.length < 3) { showMessage('Topluluk adı en az 3 karakter olmalı.', true); return; }
      submit.disabled = true;
      submit.textContent = 'Kuruluyor…';
      const join_policy = String(form.get('join_policy') || 'open');
      const { data, error } = await sb.rpc('create_community', { community_name: name, community_description: description, community_color: color, community_join_policy: join_policy });
      submit.disabled = false;
      submit.textContent = 'Topluluğu kur';
      if (error) { showMessage('Topluluk kurulamadı: ' + error.message, true); return; }
      location.hash = '#/topluluk/' + encodeURIComponent(data);
    });
    return;
  }

  const POLICY_LABEL = { open: 'Açık', approval: 'İstek onaylı', invite: 'Davetli' };

  app.innerHTML = `
    <section class="hero" style="padding-bottom:8px"><div class="eyebrow">Halka · Topluluklar</div><h1>Topluluklar${sub === 'uyelerim' ? ' · Topluluklarım' : ''}</h1><p class="subtitle">Kendi topluluğunu kur ya da ilgi alanına uyan bir halkaya katıl.</p></section>
    <div class="chips"><a class="chip ${sub !== 'uyelerim' ? 'on' : ''}" href="#/section/topluluklar">Tümü</a><a class="chip ${sub === 'uyelerim' ? 'on' : ''}" href="#/section/topluluklar?sub=uyelerim">Topluluklarım</a>${currentUser ? '<a class="chip" href="#/section/topluluklar?sub=yeni">+ Topluluk kur</a>' : ''}</div>
    <div id="inviteBox"></div>
    <div class="searchbar"><input type="text" id="communitySearch" placeholder="Topluluk ara…"></div>
    <div id="communityList">${loadingBlock('Topluluklar yükleniyor…')}</div>`;

  const [{ data: communities, error }, invitesResult, requestsResult] = await Promise.all([
    sb.from('communities').select('*').order('created_at', { ascending: false }).limit(100),
    currentUser ? sb.from('community_invites').select('id,community_id').eq('user_id', currentUser.id).eq('status', 'pending') : Promise.resolve({ data: [] }),
    currentUser ? sb.from('community_join_requests').select('community_id').eq('user_id', currentUser.id).eq('status', 'pending') : Promise.resolve({ data: [] })
  ]);
  if (location.hash !== myHash) return;
  const box = document.getElementById('communityList');
  if (!box) return;
  if (error) {
    box.innerHTML = `<div class="empty">Topluluklar yüklenemedi.<br><span class="small">${esc(error.message)}</span><br><span class="small">Veritabanı güncellemesi gerekiyor olabilir.</span></div>`;
    return;
  }
  const pendingRequests = new Set((requestsResult?.data || []).map(r => r.community_id));
  const invites = invitesResult?.data || [];

  if (invites.length) {
    const names = Object.fromEntries((communities || []).map(c => [c.id, c.name]));
    document.getElementById('inviteBox').innerHTML = `<section class="card"><div class="section-head" style="margin:0 0 10px"><h2>Bekleyen davetlerin</h2></div>${invites.map(inv => `
      <div class="member-row"><span class="member-id"><strong>${esc(names[inv.community_id] || 'Topluluk')}</strong> seni davet etti</span>
      <button class="btn primary small invite-respond" data-invite="${esc(inv.id)}" data-accept="1">Kabul et</button>
      <button class="btn ghost small invite-respond" data-invite="${esc(inv.id)}" data-accept="">Reddet</button></div>`).join('')}</section>`;
    document.querySelectorAll('.invite-respond').forEach(btn => btn.addEventListener('click', async () => {
      btn.disabled = true;
      const { error: rpcError } = await sb.rpc('respond_community_invite', { invite_id: btn.dataset.invite, accept: btn.dataset.accept === '1' });
      if (rpcError) { btn.disabled = false; alert(rpcError.message); return; }
      renderCommunities(query);
    }));
  }

  const communityIds = (communities || []).map(c => c.id);
  const { data: members } = communityIds.length
    ? await sb.from('community_members').select('community_id,user_id,role').in('community_id', communityIds)
    : { data: [] };
  const counts = {};
  const mine = new Set();
  (members || []).forEach(m => {
    counts[m.community_id] = (counts[m.community_id] || 0) + 1;
    if (currentUser && m.user_id === currentUser.id) mine.add(m.community_id);
  });
  let list = communities || [];
  if (sub === 'uyelerim') {
    if (!currentUser) { location.hash = '#/auth?signup'; return; }
    list = list.filter(c => mine.has(c.id));
  }

  const renderList = items => {
    if (!items.length) {
      box.innerHTML = `<div class="empty">${sub === 'uyelerim' ? 'Henüz bir topluluğa katılmadın.' : 'Henüz bir topluluk kurulmamış.'}<br>İlkini sen kurabilirsin.</div>`;
      return;
    }
    box.innerHTML = `<div class="community-grid">${items.map(c => {
      const joined = mine.has(c.id);
      const pending = pendingRequests.has(c.id);
      let actionBtn = '';
      if (currentUser && !joined) {
        if (c.join_policy === 'open') actionBtn = `<button class="btn small primary community-join" data-community="${esc(c.id)}" data-action="join">Katıl</button>`;
        else if (c.join_policy === 'approval') actionBtn = pending ? '<span class="member-role">İstek beklemede</span>' : `<button class="btn small primary community-join" data-community="${esc(c.id)}" data-action="request">İstek gönder</button>`;
        else actionBtn = '<span class="member-role">Davetli</span>';
      } else if (joined) {
        actionBtn = `<button class="btn small community-join" data-community="${esc(c.id)}" data-action="leave">Ayrıl</button>`;
      }
      return `
    <article class="card community-card" style="--cc:${safeHex(c.color)}">
      <div class="community-head"><span class="community-dot"></span><h3><a href="#/topluluk/${encodeURIComponent(c.id)}">${esc(c.name)}</a></h3><span class="member-role">${POLICY_LABEL[c.join_policy] || 'Açık'}</span></div>
      <p>${esc(c.description || 'Bu topluluk için henüz bir tanıtım eklenmemiş.')}</p>
      <div class="meta">${counts[c.id] || 0} üye${joined ? ' · üyesin' : ''}</div>
      <div class="post-actions"><a class="btn ghost small" href="#/topluluk/${encodeURIComponent(c.id)}">Aç</a>${actionBtn}</div>
    </article>`;
    }).join('')}</div>`;
    box.querySelectorAll('.community-join').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      const action = button.dataset.action;
      const rpc = action === 'join' ? 'join_community' : action === 'request' ? 'request_join_community' : 'leave_community';
      const { error: rpcError } = await sb.rpc(rpc, { target_community: button.dataset.community });
      if (rpcError) { button.disabled = false; alert(rpcError.message); return; }
      renderCommunities(query);
    }));
  };
  renderList(list);
  document.getElementById('communitySearch').addEventListener('input', e => {
    const term = e.target.value.toLocaleLowerCase('tr-TR').trim();
    renderList(term ? list.filter(c => (c.name || '').toLocaleLowerCase('tr-TR').includes(term) || (c.description || '').toLocaleLowerCase('tr-TR').includes(term)) : list);
  });
}

async function renderCommunity(id, query = '') {
  clearInterval(communityPollTimer);
  communityPollTimer = null;
  if (communityRealtime) { sb?.removeChannel(communityRealtime); communityRealtime = null; }
  app.innerHTML = loadingBlock('Topluluk açılıyor…');
  const { data: community, error } = await sb.from('communities').select('*').eq('id', id).maybeSingle();
  if (error || !community) {
    app.innerHTML = `<div class="empty">Topluluk bulunamadı.${error ? `<br><span class="small">${esc(error.message)}</span>` : ''}</div>`;
    return;
  }
  const { data: members } = await sb.from('community_members').select('user_id,role,joined_at').eq('community_id', id).order('joined_at', { ascending: true });
  const memberRows = members || [];
  const profiles = memberRows.length
    ? (await sb.from('profiles').select('id,username,display_name').in('id', memberRows.map(m => m.user_id))).data || []
    : [];
  const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));
  const me = memberRows.find(m => currentUser && m.user_id === currentUser.id);
  const isAdmin = me?.role === 'admin' || currentUser?.id === community.created_by;
  const isCreator = currentUser?.id === community.created_by;

  let myRequest = null;
  let myInvite = null;
  let pendingRequests = [];
  let requestProfiles = [];
  if (currentUser && !me) {
    const [reqRes, invRes] = await Promise.all([
      sb.from('community_join_requests').select('id,status').eq('community_id', id).eq('user_id', currentUser.id).eq('status', 'pending').maybeSingle(),
      sb.from('community_invites').select('id').eq('community_id', id).eq('user_id', currentUser.id).eq('status', 'pending').maybeSingle()
    ]);
    myRequest = reqRes.data;
    myInvite = invRes.data;
  }
  if (isAdmin) {
    const { data: reqs } = await sb.from('community_join_requests').select('id,user_id,created_at').eq('community_id', id).eq('status', 'pending').order('created_at', { ascending: true });
    pendingRequests = reqs || [];
    if (pendingRequests.length) {
      const rp = await sb.from('profiles').select('id,username,display_name').in('id', pendingRequests.map(r => r.user_id));
      requestProfiles = rp.data || [];
    }
  }
  const requestProfileMap = Object.fromEntries(requestProfiles.map(p => [p.id, p]));

  let channels = [];
  let activeChannel = null;
  let channelMessages = [];
  if (me) {
    const { data: ch } = await sb.from('community_channels').select('*').eq('community_id', id).order('position').order('created_at');
    channels = ch || [];
    const wantChannel = new URLSearchParams(query).get('kanal');
    activeChannel = channels.find(c => c.id === wantChannel) || channels[0] || null;
    if (activeChannel) {
      const { data: msgs } = await sb.from('community_channel_messages')
        .select('id,sender_id,body,pinned_by,created_at')
        .eq('channel_id', activeChannel.id).order('created_at', { ascending: true }).limit(200);
      channelMessages = msgs || [];
    }
  }
  const pinnedMessages = channelMessages.filter(m => m.pinned_by);
  const channelQuery = chId => `kanal=${encodeURIComponent(chId)}`;

  // Kolektif yayınlar (dergi/albüm)
  const wantCollection = new URLSearchParams(query).get('yayin');
  let collections = [], activeCollection = null, collItems = [], collPosts = [], myPosts = [];
  {
    const { data: colls } = await sb.from('community_collections').select('*').eq('community_id', id).order('created_at', { ascending: false });
    collections = colls || [];
    activeCollection = collections.find(c => c.id === wantCollection) || null;
    if (activeCollection) {
      const { data: items } = await sb.from('community_collection_items').select('*')
        .eq('collection_id', activeCollection.id).order('position').order('created_at');
      collItems = (items || []).filter(it => it.status === 'approved' || isAdmin || it.added_by === currentUser?.id);
      const postIds = [...new Set(collItems.map(i => i.post_id))];
      if (postIds.length) {
        const { data: ps } = await sb.from('posts').select('*').in('id', postIds);
        collPosts = ps || [];
        await signPostMedia(collPosts);
        collPosts = await attachBookCovers(collPosts);
      }
      if (me) {
        const { data: mp } = await sb.from('posts').select('id,title,kind,type').eq('author_id', currentUser.id).order('created_at', { ascending: false });
        myPosts = mp || [];
      }
    }
  }
  const collPostMap = Object.fromEntries(collPosts.map(p => [p.id, p]));
  const collAuthors = [...new Set(collPosts.map(p => p.author_id))];
  let collAuthorProfiles = {};
  if (collAuthors.length) {
    const { data: aps } = await sb.from('profiles').select('id,username,display_name').in('id', collAuthors);
    collAuthorProfiles = Object.fromEntries((aps || []).map(p => [p.id, p]));
  }

  const POLICY_LABEL = { open: 'Açık topluluk', approval: 'İstek onaylı', invite: 'Sadece davet' };
  let joinArea = '';
  if (!currentUser) joinArea = '<a class="btn primary" href="#/auth?signup">Katılmak için giriş yap</a>';
  else if (!me) {
    if (community.join_policy === 'open') joinArea = '<button class="btn primary" id="communityJoinBtn">Topluluğa katıl</button>';
    else if (community.join_policy === 'approval') joinArea = myRequest
      ? '<span class="member-role">Katılma isteğin onay bekliyor</span>'
      : '<button class="btn primary" id="communityRequestBtn">Katılma isteği gönder</button>';
    else joinArea = myInvite
      ? `<button class="btn primary invite-respond" data-invite="${esc(myInvite.id)}" data-accept="1">Daveti kabul et</button><button class="btn ghost invite-respond" data-invite="${esc(myInvite.id)}" data-accept="">Reddet</button>`
      : '<span class="member-role">Bu topluluk yalnızca davetle üye alıyor</span>';
  } else {
    joinArea = `<a class="btn primary" href="#/chat/${encodeURIComponent(community.conversation_id || '')}">Topluluk sohbetini aç</a>
      ${!isCreator ? '<button class="btn ghost" id="communityLeaveBtn">Ayrıl</button>' : ''}`;
  }

  app.innerHTML = `
    <section class="hero" style="padding-bottom:8px">
      <div class="eyebrow">Topluluk · ${esc(POLICY_LABEL[community.join_policy] || 'Açık topluluk')}</div>
      <h1><span class="community-dot lg" style="--cc:${safeHex(community.color)};background:${safeHex(community.color)}"></span> ${esc(community.name)}</h1>
      <p class="subtitle">${esc(community.description || 'Bu topluluk için henüz bir tanıtım eklenmemiş.')}</p>
      <p class="meta">${memberRows.length} üye · Kuruluş: ${esc(formatDate(community.created_at))}</p>
      <div class="post-actions">${joinArea}</div>
    </section>
    ${isAdmin && pendingRequests.length ? `
    <section class="card">
      <div class="section-head"><h2>Katılma istekleri (${pendingRequests.length})</h2></div>
      <div class="member-list">${pendingRequests.map(r => {
        const p = requestProfileMap[r.user_id];
        return `<div class="member-row">
          <a class="member-id" href="#/user/${encodeURIComponent(r.user_id)}"><span class="avatar">${initials(displayName(p))}</span><span>${esc(displayName(p))}</span></a>
          <span class="small">${esc(formatDate(r.created_at))}</span>
          <button class="btn primary small request-decide" data-request="${esc(r.id)}" data-approve="1">Onayla</button>
          <button class="btn ghost small request-decide" data-request="${esc(r.id)}" data-approve="">Reddet</button>
        </div>`;
      }).join('')}</div>
    </section>` : ''}
    ${me && channels.length ? `
    <section class="card">
      <div class="section-head"><h2>Kanallar</h2>${isAdmin ? '<button class="btn ghost small" id="channelAddBtn" type="button">+ Kanal</button>' : ''}</div>
      <div class="channel-tabs">${channels.map(c => `
        <a class="channel-tab ${c.id === activeChannel?.id ? 'on' : ''}" href="#/topluluk/${encodeURIComponent(id)}?${channelQuery(c.id)}">#${esc(c.name)}${isAdmin ? `<span class="channel-del" data-channel="${esc(c.id)}" title="Kanalı sil">✕</span>` : ''}</a>`).join('')}</div>
      ${pinnedMessages.length ? `<div class="channel-pinned">${pinnedMessages.map(m => `<div class="channel-pinned-msg">📌 <strong>${esc(displayName(profileMap[m.sender_id], 'Üye'))}:</strong> ${esc(m.body.slice(0, 140))}${m.body.length > 140 ? '…' : ''}</div>`).join('')}</div>` : ''}
      <div id="channelMessages" class="channel-messages">${channelMessages.length ? channelMessages.map(m => `
        <div class="channel-msg ${m.sender_id === currentUser.id ? 'mine' : ''}">
          <span class="channel-msg-author">${esc(displayName(profileMap[m.sender_id], 'Üye'))}</span>
          <span class="channel-msg-body">${esc(m.body)}</span>
          <span class="small">${esc(new Date(m.created_at).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }))}</span>
          ${isAdmin ? `<button class="chat-msg-act channel-pin" data-msg="${esc(m.id)}" data-pinned="${m.pinned_by ? '1' : ''}" type="button" title="${m.pinned_by ? 'Sabitlemeyi kaldır' : 'Sabitle'}">📌</button>` : ''}
          ${m.sender_id === currentUser.id || isAdmin ? `<button class="chat-msg-act channel-msg-del" data-msg="${esc(m.id)}" type="button" title="Sil">🗑</button>` : ''}
        </div>`).join('') : '<div class="empty">Bu kanalda henüz mesaj yok.</div>'}</div>
      <form id="channelComposeForm" class="channel-compose">
        <input id="channelMessageBody" maxlength="1000" placeholder="#${esc(activeChannel?.name || '')} kanalına yaz…" autocomplete="off">
        <button class="btn primary" type="submit">Gönder</button>
      </form>
      <div id="channelSendMessage" class="message" aria-live="polite"></div>
    </section>` : ''}
    <section class="card">
      <div class="section-head"><h2>📓 Kolektif yayınlar</h2>${isAdmin ? '<button class="btn ghost small" id="collAddBtn" type="button">+ Yayın oluştur</button>' : ''}</div>
      ${collections.length ? `<div class="channel-tabs" style="margin-bottom:10px">${collections.map(c => `
        <a class="channel-tab ${c.id === activeCollection?.id ? 'on' : ''}" href="#/topluluk/${encodeURIComponent(id)}?yayin=${encodeURIComponent(c.id)}">
          ${esc(c.title)}${c.issue_no ? ` #${c.issue_no}` : ''}${c.status === 'draft' ? ' <span class="small">(taslak)</span>' : ''}
        </a>`).join('')}</div>` : '<div class="empty small" style="margin-bottom:10px">Henüz kolektif yayın yok. Üyeler eserlerini gönderir, yöneticiler derler.</div>'}
      ${activeCollection ? `
        <div class="coll-detail">
          <div class="section-head">
            <h3>${esc(activeCollection.title)}${activeCollection.issue_no ? ` · Sayı ${activeCollection.issue_no}` : ''}</h3>
            ${isAdmin ? `<span class="member-role">${activeCollection.status === 'published' ? 'Yayında' : 'Taslak'}</span>` : ''}
          </div>
          ${activeCollection.description ? `<p class="small" style="margin-bottom:10px">${esc(activeCollection.description)}</p>` : ''}
          ${me ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
            <select id="collPostPick" style="flex:1;min-width:200px">${myPosts.filter(p => !collItems.some(it => it.post_id === p.id)).map(p => `<option value="${esc(p.id)}">${esc(p.title || 'Başlıksız')} (${esc(quickTypeLabel(p))})</option>`).join('') || '<option value="">Gönderilebilecek eserin yok</option>'}</select>
            <button class="btn ghost small" id="collSubmitBtn" type="button">📮 Eser gönder</button>
            ${isAdmin ? `<button class="btn ghost small" id="collPublishBtn" type="button">${activeCollection.status === 'published' ? '📥 Taslağa al' : '📣 Yayınla'}</button>
            <button class="btn ghost small" id="collDeleteBtn" type="button">🗑 Yayını sil</button>` : ''}
          </div>` : ''}
          ${collItems.length ? `<div class="post-list">${collItems.map(it => {
            const p = collPostMap[it.post_id];
            if (!p) return '';
            const pending = it.status === 'pending';
            const canModerate = isAdmin || it.added_by === currentUser?.id;
            return `<div class="member-row" ${pending ? 'style="opacity:.75"' : ''}>
              <a class="member-id" href="#/read/${encodeURIComponent(p.id)}">${postCoverHTML(p)}<span>${esc(p.title || 'Başlıksız eser')}<br><span class="small">${esc(quickTypeLabel(p))} · ${esc(displayName(collAuthorProfiles[p.author_id]))}</span></span></a>
              ${pending ? '<span class="member-role">Onay bekliyor</span>' : ''}
              ${isAdmin && pending ? `<button class="btn primary small coll-approve" data-item="${esc(it.post_id)}" type="button">Onayla</button>` : ''}
              ${isAdmin ? `<span style="display:flex;gap:4px"><button class="btn ghost small coll-move" data-item="${esc(it.post_id)}" data-dir="-1" type="button">↑</button><button class="btn ghost small coll-move" data-item="${esc(it.post_id)}" data-dir="1" type="button">↓</button></span>` : ''}
              ${canModerate ? `<button class="btn ghost small coll-remove" data-item="${esc(it.post_id)}" type="button" title="Kaldır">🗑</button>` : ''}
            </div>`;
          }).join('')}</div>` : '<div class="empty small">Bu yayında henüz eser yok.</div>'}
        </div>` : ''}
    </section>
    <section class="card">
      <div class="section-head"><h2>Üyeler</h2></div>
      <div class="member-list">${memberRows.map(m => {
        const p = profileMap[m.user_id];
        const role = m.role === 'admin' ? 'Yönetici' : 'Üye';
        const canManage = isAdmin && m.user_id !== currentUser?.id && m.user_id !== community.created_by;
        return `<div class="member-row">
          <a class="member-id" href="#/user/${encodeURIComponent(m.user_id)}"><span class="avatar">${initials(displayName(p))}</span><span>${esc(displayName(p))}</span></a>
          <span class="member-role ${esc(m.role)}">${role}</span>
          ${canManage ? `<button class="btn ghost small member-role-toggle" data-user="${esc(m.user_id)}" data-role="${esc(m.role)}">${m.role === 'admin' ? 'Yöneticiliği al' : 'Yönetici yap'}</button>` : ''}
          ${canManage ? `<button class="btn ghost small member-kick" data-user="${esc(m.user_id)}">Çıkar</button>` : ''}
        </div>`;
      }).join('') || '<div class="empty">Henüz üye yok.</div>'}</div>
    </section>
    ${isAdmin ? `
    <section class="card">
      <div class="section-head"><h2>Topluluk ayarları</h2></div>
      <form id="communityEditForm">
        <div class="field"><label for="ecname">Topluluk adı</label><input id="ecname" name="name" required maxlength="60" value="${esc(community.name)}"></div>
        <div class="field"><label for="ecdesc">Tanıtım</label><textarea id="ecdesc" name="description" maxlength="1200">${esc(community.description || '')}</textarea></div>
        <div class="field"><label>Renk</label><div class="color-row">${COMMUNITY_COLORS.map(c => `<label class="color-dot"><input type="radio" name="color" value="${c}" ${community.color === c ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div></div>
        <div class="field"><label for="epolicy">Kimler katılabilir?</label>
          <select id="epolicy" name="join_policy">
            <option value="open" ${community.join_policy === 'open' ? 'selected' : ''}>Herkes katılabilir</option>
            <option value="approval" ${community.join_policy === 'approval' ? 'selected' : ''}>İstek onayı</option>
            <option value="invite" ${community.join_policy === 'invite' ? 'selected' : ''}>Sadece davet</option>
          </select>
        </div>
        <button class="btn primary" type="submit">Kaydet</button>
      </form>
      <hr>
      <form id="communityInviteForm">
        <div class="field"><label for="inviteUser">Kullanıcı davet et</label>
          <input id="inviteUser" name="username" maxlength="40" placeholder="kullanıcıadı">
          <div class="small">Kullanıcı adıyla davet gönder; kişi Topluluklar sayfasında görür.</div>
        </div>
        <button class="btn" type="submit">Davet gönder</button>
      </form>
      <div id="message" class="message"></div>
      ${isCreator ? '<hr><p><button class="btn danger" id="communityDeleteBtn" type="button">Topluluğu sil</button></p>' : ''}
    </section>` : ''}`;

  document.getElementById('communityJoinBtn')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const { error: rpcError } = await sb.rpc('join_community', { target_community: id });
    if (rpcError) { btn.disabled = false; alert(rpcError.message); return; }
    renderCommunity(id, query);
  });
  document.getElementById('communityRequestBtn')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const { error: rpcError } = await sb.rpc('request_join_community', { target_community: id });
    if (rpcError) { btn.disabled = false; alert(rpcError.message); return; }
    renderCommunity(id, query);
  });
  document.querySelectorAll('.invite-respond').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    const { error: rpcError } = await sb.rpc('respond_community_invite', { invite_id: btn.dataset.invite, accept: btn.dataset.accept === '1' });
    if (rpcError) { btn.disabled = false; alert(rpcError.message); return; }
    renderCommunity(id, query);
  }));
  document.querySelectorAll('.request-decide').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    const { error: rpcError } = await sb.rpc('decide_join_request', { request_id: btn.dataset.request, approve: btn.dataset.approve === '1' });
    if (rpcError) { btn.disabled = false; alert(rpcError.message); return; }
    renderCommunity(id, query);
  }));
  document.querySelectorAll('.member-role-toggle').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    const newRole = btn.dataset.role === 'admin' ? 'member' : 'admin';
    const { error: rpcError } = await sb.from('community_members').update({ role: newRole }).eq('community_id', id).eq('user_id', btn.dataset.user);
    if (rpcError) { btn.disabled = false; alert(rpcError.message); return; }
    renderCommunity(id, query);
  }));
  document.getElementById('communityLeaveBtn')?.addEventListener('click', async e => {
    if (!confirm('Topluluktan ayrılmak istediğine emin misin?')) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    const { error: rpcError } = await sb.rpc('leave_community', { target_community: id });
    if (rpcError) { btn.disabled = false; alert(rpcError.message); return; }
    location.hash = '#/section/topluluklar';
  });
  document.querySelectorAll('.member-kick').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Bu üyeyi topluluktan çıkarmak istiyor musun?')) return;
    btn.disabled = true;
    const { error: rpcError } = await sb.rpc('remove_community_member', { target_community: id, target_user: btn.dataset.user });
    if (rpcError) { btn.disabled = false; alert(rpcError.message); return; }
    renderCommunity(id, query);
  }));
  // Kolektif yayınlar
  const goColl = cid => { location.hash = `#/topluluk/${encodeURIComponent(id)}?yayin=${encodeURIComponent(cid)}`; };
  document.getElementById('collAddBtn')?.addEventListener('click', async () => {
    const title = prompt('Yayın adı (örn. Halka Dergi):');
    if (!title?.trim()) return;
    const no = prompt('Sayı numarası (isteğe bağlı, örn. 3):');
    const { data, error } = await sb.from('community_collections').insert({
      community_id: id, title: title.trim().slice(0, 120),
      issue_no: no && /^\d+$/.test(no.trim()) ? Number(no.trim()) : null,
      created_by: currentUser.id
    }).select('id').single();
    if (error) return alert('Yayın oluşturulamadı: ' + error.message);
    goColl(data.id);
  });
  document.getElementById('collSubmitBtn')?.addEventListener('click', async () => {
    const postId = document.getElementById('collPostPick')?.value;
    if (!postId) return alert('Gönderilecek eser seç.');
    const { error } = await sb.from('community_collection_items').insert({
      collection_id: activeCollection.id, post_id: postId, added_by: currentUser.id,
      position: collItems.length
    });
    if (error) return alert('Eser gönderilemedi: ' + error.message);
    renderCommunity(id, query);
  });
  document.querySelectorAll('.coll-approve').forEach(btn => btn.addEventListener('click', async () => {
    const { error } = await sb.from('community_collection_items').update({ status: 'approved' })
      .eq('collection_id', activeCollection.id).eq('post_id', btn.dataset.item);
    if (error) return alert('Onaylanamadı: ' + error.message);
    renderCommunity(id, query);
  }));
  document.querySelectorAll('.coll-remove').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Eser yayından kaldırılsın mı?')) return;
    const { error } = await sb.from('community_collection_items').delete()
      .eq('collection_id', activeCollection.id).eq('post_id', btn.dataset.item);
    if (error) return alert('Kaldırılamadı: ' + error.message);
    renderCommunity(id, query);
  }));
  document.querySelectorAll('.coll-move').forEach(btn => btn.addEventListener('click', async () => {
    const it = collItems.find(x => x.post_id === btn.dataset.item);
    if (!it) return;
    const idx = collItems.indexOf(it);
    const swap = collItems[idx + Number(btn.dataset.dir)];
    if (!swap) return;
    await Promise.all([
      sb.from('community_collection_items').update({ position: swap.position }).eq('collection_id', activeCollection.id).eq('post_id', it.post_id),
      sb.from('community_collection_items').update({ position: it.position }).eq('collection_id', activeCollection.id).eq('post_id', swap.post_id)
    ]);
    renderCommunity(id, query);
  }));
  document.getElementById('collPublishBtn')?.addEventListener('click', async () => {
    const next = activeCollection.status === 'published' ? 'draft' : 'published';
    const { error } = await sb.from('community_collections').update(
      next === 'published' ? { status: 'published', published_at: new Date().toISOString() } : { status: 'draft' }
    ).eq('id', activeCollection.id);
    if (error) return alert('Güncellenemedi: ' + error.message);
    renderCommunity(id, query);
  });
  document.getElementById('collDeleteBtn')?.addEventListener('click', async () => {
    if (!confirm('Bu kolektif yayın ve içindeki liste silinsin mi? (Eserler silinmez)')) return;
    const { error } = await sb.from('community_collections').delete().eq('id', activeCollection.id);
    if (error) return alert('Silinemedi: ' + error.message);
    location.hash = `#/topluluk/${encodeURIComponent(id)}`;
  });

  document.getElementById('communityEditForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const payload = {
      name: String(form.get('name') || '').trim(),
      description: String(form.get('description') || '').trim(),
      color: String(form.get('color') || community.color),
      join_policy: String(form.get('join_policy') || community.join_policy || 'open')
    };
    const { error: updateError } = await sb.from('communities').update(payload).eq('id', id);
    showMessage(updateError ? 'Kaydedilemedi: ' + updateError.message : 'Topluluk güncellendi.', !!updateError);
    if (!updateError) renderCommunity(id, query);
  });
  document.getElementById('communityInviteForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const inviteForm = e.currentTarget;
    const username = String(new FormData(inviteForm).get('username') || '').trim();
    if (!username) return;
    const btn = inviteForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    const { error: rpcError } = await sb.rpc('invite_community_member', { target_community: id, target_username: username });
    btn.disabled = false;
    showMessage(rpcError ? 'Davet gönderilemedi: ' + rpcError.message : `Davet gönderildi: @${username}`, !!rpcError);
    if (!rpcError) inviteForm.reset();
  });
  document.getElementById('communityDeleteBtn')?.addEventListener('click', async () => {
    if (!confirm('Topluluk kalıcı olarak silinecek. Emin misin?')) return;
    if (prompt('Silmek için SİL yaz:') !== 'SİL') return;
    const { error: delError } = await sb.rpc('delete_community', { target_community: id });
    if (delError) { alert(delError.message); return; }
    location.hash = '#/section/topluluklar';
  });

  if (me && activeChannel) {
    const reloadChannel = async () => {
      const box = document.getElementById('channelMessages');
      if (!box || !location.hash.includes(id)) return;
      const { data: msgs } = await sb.from('community_channel_messages')
        .select('id,sender_id,body,pinned_by,created_at')
        .eq('channel_id', activeChannel.id).order('created_at', { ascending: true }).limit(200);
      if (msgs) channelMessages = msgs;
      const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      box.innerHTML = channelMessages.length ? channelMessages.map(m => `
        <div class="channel-msg ${m.sender_id === currentUser.id ? 'mine' : ''}">
          <span class="channel-msg-author">${esc(displayName(profileMap[m.sender_id], 'Üye'))}</span>
          <span class="channel-msg-body">${esc(m.body)}</span>
          <span class="small">${esc(new Date(m.created_at).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }))}</span>
          ${isAdmin ? `<button class="chat-msg-act channel-pin" data-msg="${esc(m.id)}" data-pinned="${m.pinned_by ? '1' : ''}" type="button" title="${m.pinned_by ? 'Sabitlemeyi kaldır' : 'Sabitle'}">📌</button>` : ''}
          ${m.sender_id === currentUser.id || isAdmin ? `<button class="chat-msg-act channel-msg-del" data-msg="${esc(m.id)}" type="button" title="Sil">🗑</button>` : ''}
        </div>`).join('') : '<div class="empty">Bu kanalda henüz mesaj yok.</div>';
      if (nearBottom) box.scrollTop = box.scrollHeight;
      const pinnedBox = box.parentElement.querySelector('.channel-pinned');
      const pins = channelMessages.filter(m => m.pinned_by);
      if (pinnedBox) pinnedBox.innerHTML = pins.map(m => `<div class="channel-pinned-msg">📌 <strong>${esc(displayName(profileMap[m.sender_id], 'Üye'))}:</strong> ${esc(m.body.slice(0, 140))}${m.body.length > 140 ? '…' : ''}</div>`).join('');
      else if (pins.length) box.insertAdjacentHTML('beforebegin', `<div class="channel-pinned">${pins.map(m => `<div class="channel-pinned-msg">📌 <strong>${esc(displayName(profileMap[m.sender_id], 'Üye'))}:</strong> ${esc(m.body.slice(0, 140))}${m.body.length > 140 ? '…' : ''}</div>`).join('')}</div>`);
    };
    document.getElementById('channelComposeForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const input = document.getElementById('channelMessageBody');
      const body = input.value.trim();
      if (!body) return;
      const { error: sendError } = await sb.from('community_channel_messages').insert({ channel_id: activeChannel.id, sender_id: currentUser.id, body });
      if (sendError) { setSettingsMessage(document.getElementById('channelSendMessage'), `Mesaj gönderilemedi: ${sendError.message}`, true); return; }
      input.value = '';
      setSettingsMessage(document.getElementById('channelSendMessage'), '');
      await reloadChannel();
      const box = document.getElementById('channelMessages');
      if (box) box.scrollTop = box.scrollHeight;
    });
    document.getElementById('channelAddBtn')?.addEventListener('click', async () => {
      const name = prompt('Yeni kanal adı (küçük harf, boşluksuz):');
      if (!name) return;
      const cleaned = name.trim().replace(/\s+/g, '-').slice(0, 40);
      if (!cleaned) return;
      const { error: chErr } = await sb.from('community_channels').insert({ community_id: id, name: cleaned, position: channels.length });
      if (chErr) { alert('Kanal oluşturulamadı: ' + chErr.message); return; }
      renderCommunity(id, query);
    });
    document.getElementById('channelMessages')?.addEventListener('click', async e => {
      const pinBtn = e.target.closest('.channel-pin');
      const delBtn = e.target.closest('.channel-msg-del');
      if (pinBtn) {
        await sb.from('community_channel_messages').update({ pinned_by: pinBtn.dataset.pinned ? null : currentUser.id }).eq('id', pinBtn.dataset.msg);
        await reloadChannel();
        return;
      }
      if (delBtn) {
        if (!confirm('Mesajı silmek istiyor musun?')) return;
        await sb.from('community_channel_messages').delete().eq('id', delBtn.dataset.msg);
        await reloadChannel();
      }
    });
    document.querySelectorAll('.channel-del').forEach(el => el.addEventListener('click', async e => {
      e.preventDefault();
      const ch = channels.find(c => c.id === el.dataset.channel);
      if (!ch || !confirm(`#${ch.name} kanalını ve içindeki tüm mesajları silmek istiyor musun?`)) return;
      const { error: delErr } = await sb.from('community_channels').delete().eq('id', ch.id);
      if (delErr) { alert('Kanal silinemedi: ' + delErr.message); return; }
      location.hash = `#/topluluk/${encodeURIComponent(id)}`;
    }));
    try {
      communityRealtime = sb.channel(`community-channel-${activeChannel.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'community_channel_messages', filter: `channel_id=eq.${activeChannel.id}` }, () => reloadChannel())
        .subscribe();
    } catch {}
    communityPollTimer = setInterval(reloadChannel, 30000);
    reloadChannel();
  }
}

function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), query };
}

const safeDecode = value => { try { return decodeURIComponent(value || ''); } catch { return ''; } };

async function route() {
  const { parts, query } = parseRoute();
  const [view, arg] = parts;
  if (view !== 'create' && view !== 'write') flushDraftAbandon();
  document.body.classList.toggle('quick-mode', view === 'section' && arg === 'kesfet' && new URLSearchParams(query).get('sub') === 'hizli');
  if (view !== 'chat') {
    clearInterval(chatRefreshTimer); chatRefreshTimer = null;
    if (chatChannel) { sb?.removeChannel(chatChannel); chatChannel = null; }
  }
  if (view !== 'topluluk') {
    clearInterval(communityPollTimer); communityPollTimer = null;
    if (communityRealtime) { sb?.removeChannel(communityRealtime); communityRealtime = null; }
  }
  if (view !== 'relay' && relayRealtime) { sb?.removeChannel(relayRealtime); relayRealtime = null; }
  if (readScrollHandler) { window.removeEventListener('scroll', readScrollHandler); readScrollHandler = null; }
  stopCameraStream();
  window.scrollTo(0, 0);
  setNav();
  updateHelperContext();
  if (!view) return renderHome();
  if (view === 'auth') {
    if (new URLSearchParams(query).get('mfa') === '1' || query === 'mfa') return renderMfaChallenge();
    return renderAuth(query === 'signup' ? 'signup' : 'login');
  }
  if (view === 'legal') return renderLegalPage(arg || 'terms');
  if (view === 'search') return renderSearch(new URLSearchParams(query).get('q') || '');
  if (view === 'write') {
    renderWrite();
    const k = new URLSearchParams(query).get('kind');
    const sel = document.getElementById('kind');
    const kind = k === 'story' ? 'book' : k;
    if (sel && kind && [...sel.options].some(o => o.value === kind)) {
      sel.value = kind;
      sel.dispatchEvent(new Event('change'));
    }
    return;
  }
  if (view === 'section') return renderSection(arg, query);
  if (view === 'create') return renderCreate(arg, new URLSearchParams(query).get('mode'));
  if (view === 'read') return renderRead(safeDecode(arg), query);
  if (view === 'profile') return renderProfile('me');
  if (view === 'settings') return renderSettings();
  if (view === 'notifications') return renderNotifications();
  if (view === 'admin') return renderAdmin();
  if (view === 'bugreport') return renderBugReport();
  if (view === 'chat') return renderChat(arg || '', query);
  if (view === 'topluluk') return renderCommunity(safeDecode(arg), query);
  if (view === 'koleksiyonlar') return renderCollections();
  if (view === 'ozet') return renderOzet();
  if (view === 'relay') return arg ? renderRelay(safeDecode(arg)) : renderRelayList();
  if (view === 'user') return renderProfile(safeDecode(arg));
  return renderHome();
}

const helperPageTips = {
  '': 'Ana sayfadasın: öne çıkan eserler ve yeni paylaşımlar burada. Bir kitabı yarıda bırakırsan "Okumaya devam et" kartı seni bekler.',
  'section': 'Keşfet bölümündesin. Filtrelerle yazı, çizim, fotoğraf, video ve müzik eserlerini gezebilir; Hızlı Keşfet ile kaydırarak bakabilirsin.',
  'search': 'Arama sayfasındasın: kullanıcı, eser, topluluk veya #hashtag yazarak arayabilirsin.',
  'write': 'Yazı sayfasındasın. **kalın** ve (italik) düğmeleri metni biçimlendirir. Kitap yazıyorsan ilk bölümü buradan ekleyip sonra yenilerini ekleyebilirsin.',
  'create': 'Üretim sayfasındasın: tuvalde çiz, kamerayla foto/video çek ya da müzik kaydet. Yayımlamadan çıkarsan taslak yarım sayılır.',
  'read': 'Eser okuma sayfasındasın. Kitap gibi bölümlü eserlerde kaldığın yer otomatik kaydedilir.',
  'chat': 'Sohbettеsin: mesajlar anında gelir, yazarken karşı taraf görür, mesajlara emoji tepkisi verebilir, kendi mesajını düzenleyebilir veya silebilirsin.',
  'profile': 'Profil sayfandayım: rozetlerine tıklayınca detaylarını ve nadirliğini görürsün. Kazandığın bir rozeti profilinde öne çıkarabilirsin.',
  'settings': 'Ayarlar sayfasındasın: ad, görünürlük, tema ve güvenlik seçenekleri burada.',
  'notifications': 'Bildirimler sayfasındasın: beğeni, yorum, takip, mesaj ve rozet haberlerin burada.',
  'topluluk': 'Topluluk sayfasındasın: kanallar arasında gez, önemli mesajlar sabitlenmiş olabilir.',
  'koleksiyonlar': 'Koleksiyon sayfasındasın: kaydettiğin eserleri tematik listelerde topla.',
  'relay': 'Nöbetleşe hikâyedesin: iki kişi sırayla paragraf yazarsınız. Sıra sendeyken alt kısımdan devamını yazabilirsin.',
  'ozet': 'Halka Özetin sayfasındasın: bu yılki üretiminin rakamları burada.',
  'admin': 'Yönetim panelindesin: raporlar, bayraklar, istatistikler ve rozet verme araçları burada.'
};
function updateHelperContext() {
  const view = location.hash.replace(/^#\/?/, '').split('?')[0].split('/')[0] || '';
  if (helperPageTips[view]) helperAnswer.textContent = helperPageTips[view];
}
function cemberCelebrate(text) {
  helperAnswer.textContent = text;
  helperToggle.classList.add('celebrate');
  setTimeout(() => helperToggle.classList.remove('celebrate'), 4000);
  if (helperPanel.hidden) {
    helperPanel.hidden = false;
    helperToggle.setAttribute('aria-expanded', 'true');
  }
}

async function init() {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      storage: window.localStorage
    }
  });
  let session = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await sb.auth.getSession();
      session = res?.data?.session || null;
    } catch {}
    if (session) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  currentUser = session?.user ?? null;
  lastAccessToken = session?.access_token ?? null;
  if (currentUser) {
    try {
      const pending = JSON.parse(localStorage.getItem('halka_pending_legal_consent') || 'null');
      const metadata = currentUser.user_metadata || {};
      const consent = pending || (metadata.terms_version ? metadata : null);
      if (consent && consent.terms_version === LEGAL_VERSIONS.terms && consent.privacy_version === LEGAL_VERSIONS.privacy && consent.community_rules_version === LEGAL_VERSIONS.community) {
        const { error } = await sb.rpc('record_legal_acceptance', {
          accepted_terms_version: consent.terms_version,
          accepted_privacy_version: consent.privacy_version,
          accepted_community_version: consent.community_rules_version
        });
        if (!error) localStorage.removeItem('halka_pending_legal_consent');
      }
    } catch {}
  }
  await loadProfile();
  if (await requireMfaChallenge()) location.hash = '#/auth?mfa';
  await refreshAdminAccess();
  sb.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user ?? null;
    lastAccessToken = session?.access_token ?? null;
    if (!currentUser) isCurrentUserAdmin = false;
    setTimeout(async () => {
      await loadProfile();
      await refreshAdminAccess();
      setNav();
      watchNotifications();
      if (event === 'SIGNED_IN' && await requireMfaChallenge()) location.hash = '#/auth?mfa';
    }, 0);
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('pagehide', flushDraftAbandonOnLeave);
  setInterval(refreshNotificationBadge, 60000);
  let notifRealtime = null;
  const watchNotifications = () => {
    if (notifRealtime) { sb.removeChannel(notifRealtime); notifRealtime = null; }
    if (!currentUser) return;
    try {
      notifRealtime = sb.channel(`notif-${currentUser.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUser.id}` }, () => {
          refreshNotificationBadge();
          if (!location.hash.startsWith('#/notifications')) cemberCelebrate('🔔 Yeni bir bildirimin var — Bildirimler sayfasına bakabilirsin.');
        })
        .subscribe();
    } catch {}
  };
  watchNotifications();
  setInterval(() => {
    if (!currentUser || document.hidden) return;
    sb.from('profiles').update({ last_active_at: new Date().toISOString() }).eq('id', currentUser.id).then(() => {});
  }, 120000);
  route();
}

const helperPanel = document.getElementById('halkaHelperPanel');
const helperToggle = document.getElementById('halkaHelperToggle');
const helperAnswer = document.getElementById('halkaHelperAnswer');
const helperReplies = {
  book: ['Kitap yazmak için + menüsünden Yazı → Kitap’ı seç. Kitap adı, kısa tanıtım, istersen kapak ve ilk bölümünü ekle. **kalın** ve (italik) düğmeleri metni biçimlendirir.', '#/write?kind=book'],
  discover: ['Keşfet’te Tümü, Videolar, Çizimler, Resimler ve Yazılar filtreleri var. Hızlı keşfet görünümünde eserleri kaydırarak gezebilirsin.', '#/section/kesfet'],
  chat: () => [currentUser ? 'Sohbet sayfasında kullanıcı adıyla bire bir veya grup sohbeti başlatabilir, eser ve dosya paylaşabilirsin.' : 'Sohbetleri kullanmak için önce giriş yapman gerekir.', currentUser ? '#/chat' : '#/auth?login'],
  security: () => [currentUser ? 'Hesap ayarlarında şifreni ve e-posta adresini değiştirebilir, iki adımlı doğrulamayı açabilirsin.' : 'Hesap güvenliği ayarları için giriş yapmalısın.', currentUser ? '#/settings' : '#/auth?login'],
  image: ['+ menüsünden Çizim, Fotoğraf veya Video’yu seçebilirsin: çizimi tuvalde yapar, fotoğrafı kamerayla çeker veya videoyu kaydedebilir, dilersen hazır dosya da yükleyebilirsin.', '#/section/kesfet'],
  music: ['Müziğini + menüsünden Müzik’i seçerek paylaş: ses dosyası yükleyebilir, mikrofonla kayıt yapabilir veya Spotify/YouTube/SoundCloud bağlantısı ekleyebilirsin.', '#/create/music?mode=file'],
  community: ['Topluluklar bölümünden yeni bir topluluk kurabilir veya var olanlara katılabilirsin. Her topluluğun kendi grup sohbeti, üyeleri ve yöneticileri olur.', '#/section/topluluklar'],
  signup: () => [currentUser ? 'Zaten giriş yaptın! Profilini düzenlemek için Profilim sayfasını kullanabilirsin.' : 'Sağ üstteki "Hesap oluştur" düğmesine dokun. E-postayla kayıt olabilir veya Google/GitHub hesabınla devam edebilirsin. Kullanıcı adı seçip topluluk kurallarını onayladığında hazırsın.', currentUser ? '#/profile' : '#/auth?signup'],
  chatcustom: ['Sohbet sayfasında bir sohbeti aç, sağ üstteki özelleştirme düğmesine dokun. Oradan sohbet adını ve tema rengini değiştirebilirsin.', '#/chat'],
  profile: () => [currentUser ? 'Profilim sayfasında görünen adını, kullanıcı adını, biyografini ve avatarını düzenleyebilirsin. Ayrıca profil görünümü ve vurgu rengi seçenekleri var.' : 'Profil ayarları için önce giriş yapmalısın.', currentUser ? '#/profile' : '#/auth?login'],
  help: ['Ben Çember, Halka’daki yardımcınım! Hesap açma, eser paylaşma, müzik, topluluk, sohbet kişiselleştirme ve güvenlik konularında yol gösterebilirim. Aşağıdaki seçeneklerden birini seçebilirsin.', null]
};
function showHelperReply(key, navigate = false) {
  const option = helperReplies[key] || helperReplies.help;
  const [reply, route] = typeof option === 'function' ? option() : option;
  helperAnswer.textContent = reply;
  if (navigate && route) location.hash = route;
}
helperToggle.addEventListener('click', () => {
  const opening = helperPanel.hidden;
  helperPanel.hidden = !opening;
  helperToggle.setAttribute('aria-expanded', String(opening));
  if (opening) document.getElementById('halkaHelperInput').focus();
});
document.getElementById('halkaHelperClose').addEventListener('click', () => {
  helperPanel.hidden = true;
  helperToggle.setAttribute('aria-expanded', 'false');
});
helperPanel.querySelectorAll('[data-help]').forEach(button => button.addEventListener('click', () => showHelperReply(button.dataset.help, true)));
document.getElementById('halkaHelperForm').addEventListener('submit', event => {
  event.preventDefault();
  const question = document.getElementById('halkaHelperInput').value.toLocaleLowerCase('tr-TR');
  const key = /müzik|muzik|şarkı|sarki|beste|parça|parca|ses kayıt|ses kayit/.test(question) ? 'music'
    : /topluluk|community|sunucu/.test(question) ? 'community'
    : /sohbet.*(kişiselleştir|kisisellestir|özelleştir|ozellestir|renk|ad|isim)|kişiselleştir|kisisellestir/.test(question) ? 'chatcustom'
    : /kayıt|kayit|üye|uye|hesap aç|hesap ac|giriş|giris|signup|login/.test(question) ? 'signup'
    : /profil|avatar|biyografi|kullanıcı adı|kullanici adi/.test(question) ? 'profile'
    : /kitap|blog|yazı|yazi|bölüm|bolum/.test(question) ? 'book'
    : /(yükle|yukle|ekle|paylaş|paylas).*(foto|görsel|gorsel|resim|video|çizim)|(?:foto|görsel|gorsel|resim|video|çizim).*(yükle|yukle|ekle|paylaş|paylas)/.test(question) ? 'image'
    : /keşfet|kesfet|video|çizim|resim|fotoğraf|fotograf/.test(question) ? 'discover'
    : /sohbet|mesaj|grup/.test(question) ? 'chat'
    : /şifre|sifre|güven|guven|hesap/.test(question) ? 'security'
    : /foto|görsel|gorsel|resim|video/.test(question) ? 'image' : 'help';
  showHelperReply(key);
  event.currentTarget.reset();
});

init().catch(err => {
  app.innerHTML = `<div class="empty">Halka başlatılamadı.<br><span class="small">${esc(err.message)}</span></div>`;
});
