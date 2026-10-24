import json, os, subprocess, time, urllib.request

def get_token():
    p = subprocess.run('printf "protocol=https\nhost=github.com\n\n" | git credential fill',
        shell=True, capture_output=True, text=True, cwd=r'C:\Users\burak\Desktop\HALKA')
    for line in p.stdout.splitlines():
        if line.startswith('password='):
            return line.split('=', 1)[1]
    return None

TOK = get_token()
HDR = {'Authorization': f'Bearer {TOK}', 'Accept': 'application/vnd.github+json'}

for i in range(60):  # 2 saat × 2 dk
    try:
        import ssl
        ctx = ssl.create_default_context()
        conn = urllib.request.build_opener()
        req = urllib.request.Request('https://halka-sosyal.com/', headers={'User-Agent': 'halka-check'})
        r = conn.open(req, timeout=12)
        code = r.status
    except Exception as e:
        code = str(e)[:60]
    print(f'[{time.strftime("%H:%M")}] try{i+1}: {code}', flush=True)
    if str(code) == '200':
        req = urllib.request.Request('https://api.github.com/repos/Masked-afk/HALKA/pages',
            data=json.dumps({'https_enforced': True}).encode(),
            headers={**HDR, 'Content-Type': 'application/json'}, method='PUT')
        try:
            urllib.request.urlopen(req, timeout=15)
            print('HTTPS ENFORCED ✓', flush=True)
        except Exception as e:
            print(f'enforce hatasi: {e}', flush=True)
        break
    time.sleep(120)
