import json, subprocess, time, urllib.request
def get_token():
    p = subprocess.run('printf "protocol=https\nhost=github.com\n\n" | git credential fill',
        shell=True, capture_output=True, text=True, cwd=r'C:\Users\burak\Desktop\HALKA')
    return next((l.split('=',1)[1] for l in p.stdout.splitlines() if l.startswith('password=')), None)
TOK = get_token()
HDR = {'Authorization': f'Bearer {TOK}', 'Accept': 'application/vnd.github+json'}
for i in range(90):  # 3 saat x 2 dk
    try:
        r = urllib.request.urlopen(urllib.request.Request('https://halka-sosyal.com/', headers={'User-Agent':'x'}), timeout=10)
        code = r.status
    except Exception as e: code = 'fail'
    print(f'[{time.strftime("%H:%M")}] #{i+1} https={code}', flush=True)
    if code == 200:
        req = urllib.request.Request('https://api.github.com/repos/Masked-afk/HALKA/pages',
            data=json.dumps({'https_enforced': True}).encode(), headers={**HDR,'Content-Type':'application/json'}, method='PUT')
        try: urllib.request.urlopen(req, timeout=15); print('HTTPS ENFORCED OK', flush=True)
        except Exception as e: print('enforce err:', e, flush=True)
        break
    time.sleep(120)
