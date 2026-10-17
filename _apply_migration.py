import sys, pathlib, socket
import psycopg2

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

pw = pathlib.Path(r"C:\Users\burak\Desktop\HALKA\.db-password.txt").read_text().strip()
ref = "srdjknlfqnmsozyewvxa"
sql_path = sys.argv[1]
sql = pathlib.Path(sql_path).read_text(encoding="utf-8")

regions = ["eu-central-1", "eu-central-2", "eu-west-1", "eu-west-2", "eu-west-3",
           "eu-north-1", "eu-south-1", "eu-south-2",
           "us-east-1", "us-east-2", "us-west-1", "us-west-2",
           "ca-central-1", "sa-east-1",
           "ap-south-1", "ap-south-2", "ap-northeast-1", "ap-northeast-2", "ap-northeast-3",
           "ap-southeast-1", "ap-southeast-2", "ap-southeast-3", "ap-east-1",
           "me-south-1", "me-central-1", "af-south-1", "il-central-1"]

conn = None
for prefix in ["aws-0", "aws-1"]:
    for region in regions:
        host = f"{prefix}-{region}.pooler.supabase.com"
        label = f"{prefix}-{region}"
        try:
            socket.gethostbyname(host)
        except Exception:
            continue
        try:
            conn = psycopg2.connect(host=host, port=5432, user=f"postgres.{ref}", password=pw,
                                    dbname="postgres", connect_timeout=6, sslmode="require")
            print(f"CONNECTED via {label} ({host})")
            break
        except Exception as e:
            msg = str(e).splitlines()[0][:110]
            if "Tenant or user not found" in str(e) or "tenant" in str(e).lower():
                pass  # wrong region
            else:
                print(f"fail {label}: {msg}")
    if conn:
        break

if conn is None:
    print("NO CONNECTION"); sys.exit(1)

conn.autocommit = True
cur = conn.cursor()
try:
    cur.execute(sql)
    print("MIGRATION APPLIED")
except Exception as e:
    print("MIGRATION FAILED:", e)
    conn.close(); sys.exit(2)

probes = [
    ("anon select grant on chapter_likes", "select has_table_privilege('anon','public.chapter_likes','select')"),
    ("comments hide-draft policy count", "select count(*) from pg_policies where policyname='Hide comments on draft chapters'"),
    ("chapter_likes select policy roles", "select string_agg(r,',') from (select unnest(roles) r from pg_policies where policyname='Readers see chapter likes') t"),
]
for name, q in probes:
    try:
        cur.execute(q)
        print(f"probe[{name}] ->", cur.fetchone())
    except Exception as e:
        print(f"probe[{name}] ERROR:", e)
conn.close()
