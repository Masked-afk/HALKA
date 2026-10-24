import subprocess, time, urllib.request
from datetime import datetime
for i in range(36):  # 3 saat × 5 dk
    try:
        r = subprocess.run(['nslookup','halka-sosyal.com','8.8.8.8'], capture_output=True, text=True, timeout=15)
        out = r.stdout + r.stderr
        ok = '185.199.' in out
    except Exception as e:
        ok = False; out = str(e)
    stamp = datetime.now().strftime('%H:%M')
    if ok:
        print(f'[{stamp}] RESOLVED - GitHub IP gorunuyor', flush=True)
        try:
            req = urllib.request.Request('http://halka-sosyal.com/', headers={'User-Agent':'halka-check'})
            resp = urllib.request.urlopen(req, timeout=10)
            print(f'[{stamp}] HTTP {resp.status} - site aciliyor', flush=True)
        except Exception as e:
            print(f'[{stamp}] site henuz yuklenmedi: {e}', flush=True)
        break
    print(f'[{stamp}] check {i+1}/36 - henuz yayilmadi', flush=True)
    time.sleep(300)
else:
    print('3 saat doldu, hala cozulmedi - Metunic kayitlarini kontrol et', flush=True)
