# Tarayıcı simülasyonu — ürün dosyası değildir.
import asyncio, sys
from playwright.async_api import async_playwright

SITE = 'http://127.0.0.1:8080'
results = []
def ok(name, cond, extra=''):
    results.append(('PASS' if cond else 'FAIL', name, extra))

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        errors = []
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))

        # 1) Ana sayfa
        await page.goto(SITE, wait_until='networkidle', timeout=30000)
        await page.wait_for_timeout(2500)
        ok('Sayfa yüklendi', await page.locator('#app').count() > 0)
        ok('Feed kartları', await page.locator('.post-card, .post-grid a, [href*="#/read/"]').count() > 0)
        ok('Senin için chip', await page.locator('#forYouChip').count() > 0)

        # 2) Senin için chip toggle
        chip = page.locator('#forYouChip')
        if await chip.count():
            await chip.click()
            await page.wait_for_timeout(1200)
            ok('Senin için toggle', 'on' in (await chip.get_attribute('class') or ''))

        # 3) Bir esere gir
        first = page.locator('a[href*="#/read/"]').first
        ok('Eser linki var', await first.count() > 0)
        if await first.count():
            await first.click()
            await page.wait_for_timeout(3000)

            ok('Beğeni düğmesi', await page.locator('#readLikeBtn').count() > 0)
            ok('Emoji tepki çipleri (5)', await page.locator('#postReactions .react-chip').count() == 5,
               str(await page.locator('#postReactions .react-chip').count()))
            ok('Kart düğmesi', await page.locator('#shareCardBtn').count() > 0)
            ok('Yorum formu', await page.locator('#commentForm, .comment-form').count() > 0)

            # Anonim: GIF/sesli düğmeleri yorum formunda
            ok('GIF düğmesi (form)', await page.locator('.comment-gif-btn').count() > 0)
            ok('Sesli düğme (form)', await page.locator('.comment-voice-btn').count() > 0)

            # 4) GIF seçici fonksiyon düzeyinde aç (login korumasını bypass)
            await page.evaluate("openGifPicker(u => window.__gif = u)")
            await page.wait_for_timeout(2500)
            ok('GIF seçici açıldı', await page.locator('.gif-picker').count() > 0)
            gifcount = await page.locator('.gif-item').count()
            ok('GIPHY görselleri geldi', gifcount > 0, str(gifcount))
            if gifcount:
                await page.locator('.gif-item').first.click()
                await page.wait_for_timeout(300)
                ok('GIF seçimi URL döndü', bool(await page.evaluate('window.__gif')))

            # 5) Temalı oynatıcı
            ok('Temalı ses oynatıcı', await page.locator('.h-player').count() > 0)
            ok('Temalı video oynatıcı', await page.locator('.h-vplayer').count() > 0)

            # 6) Paylaşım kartı (canvas üretimi)
            dl = await page.evaluate("""() => new Promise(res => {
              const cv = document.createElement('canvas'); cv.width = 10; cv.height = 10;
              cv.toBlob ? res('canvas ok') : res('no canvas');
            })""")
            ok('Canvas desteği', 'ok' in dl)

            # 7) Anonim tıklama → signup yönlendirmesi
            chipbtn = page.locator('#postReactions .react-chip').first
            if await chipbtn.count():
                await chipbtn.click()
                await page.wait_for_timeout(400)
                ok('Anon tepki → signup', '#/auth' in page.url)

        # 8) Service worker + manifest
        swok = await page.evaluate("navigator.serviceWorker.getRegistrations().then(r => r.length)")
        ok('Service worker kayıtlı', swok >= 1, str(swok))
        ok('Manifest linki', await page.locator('link[rel="manifest"]').count() > 0)

        # 9) Konsol hataları
        bad = [e for e in errors if 'favicon' not in e.lower() and 'service worker' not in e.lower() and 'font' not in e.lower()]
        ok('JS hatasız (kritik)', len(bad) == 0, ' | '.join(bad[:3]))

        await browser.close()

asyncio.run(main())
print('\n=== TARAYICI TESTİ ===')
for s, n, x in results:
    print(f'{s}: {n}' + (f' — {x}' if x else ''))
print(f'\nToplam: {sum(1 for s,_,_ in results if s=="PASS")}/{len(results)}')
