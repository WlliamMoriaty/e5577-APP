import inspect, json, re
from pathlib import Path
from huawei_lte_api.Client import Client
from huawei_lte_api.Connection import Connection

URL = 'http://192.168.8.1/'
SENSITIVE = ('imei', 'imsi', 'iccid', 'serial', 'macaddress', 'msisdn', 'password',
             'pwd', 'token', 'ssid', 'phonenumber', 'wpapsk', 'wepkey', 'psk')
MAC_RE = re.compile(r'\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b')
NUM_RE = re.compile(r'\b\d{14,}\b')

# read-only getters only (normalized: lowercase, no underscores)
READ = [
    ('device', 'information'), ('device', 'signal'), ('device', 'basicinformation'),
    ('monitoring', 'status'), ('monitoring', 'trafficstatistics'),
    ('monitoring', 'monthstatistics'), ('monitoring', 'checknotifications'),
    ('monitoring', 'convergedstatus'), ('monitoring', 'startdate'),
    ('net', 'currentplmn'), ('net', 'netmode'), ('net', 'netmodelist'),
    ('dialup', 'connection'), ('dialup', 'profiles'), ('dialup', 'mobiledataswitch'),
    ('wlan', 'basicsettings'), ('wlan', 'hostlist'),
    ('dhcp', 'settings'), ('sms', 'smscount'), ('sms', 'config'),
    ('ussd', 'status'), ('global', 'moduleswitch'), ('language', 'currentlanguage'),
    ('pin', 'status'), ('cradle', 'statusinfo'), ('cradle', 'basicinfo'),
    ('host', 'info'), ('vpn', 'status'),
    ('security', 'bridgemode'), ('security', 'dmz'), ('security', 'nat'),
    ('security', 'upnp'), ('security', 'virtualservers'),
]

def norm(s): return s.lower().replace('_', '')

def redact(o, key=''):
    if isinstance(o, dict):
        return {k: redact(v, str(k)) for k, v in o.items()}
    if isinstance(o, list):
        return [redact(v, key) for v in o]
    if isinstance(o, str):
        k = key.lower()
        if o and (k == 'mac' or any(s in k for s in SENSITIVE)):
            return '<redacted>'
        return NUM_RE.sub('<num>', MAC_RE.sub('<mac>', o))
    return o

def required_args(fn):
    try:
        return [p for p in inspect.signature(fn).parameters.values()
                if p.default is p.empty and p.kind in (p.POSITIONAL_OR_KEYWORD, p.KEYWORD_ONLY)]
    except (TypeError, ValueError):
        return ['?']

user = input('Username [admin]: ').strip() or 'admin'
pw = input('Password (visible): ')
out = {'catalog': {}, 'data': {}, 'errors': {}, 'ussd_source': ''}

with Connection(URL, username=user, password=pw) as c:
    cl = Client(c)
    groups = {n: getattr(cl, n) for n in dir(cl)
              if not n.startswith('_') and type(getattr(cl, n)).__module__.startswith('huawei_lte_api.api')}
    for gn, g in groups.items():
        out['catalog'][gn] = {}
        for m in dir(g):
            f = getattr(g, m)
            if not m.startswith('_') and callable(f):
                try: out['catalog'][gn][m] = str(inspect.signature(f))
                except (TypeError, ValueError): out['catalog'][gn][m] = '?'
        if norm(gn) == 'ussd':
            try: out['ussd_source'] = inspect.getsource(type(g))
            except OSError: pass
    for gnorm, mnorm in READ:
        gname = next((n for n in groups if norm(n) == gnorm), None)
        if not gname: continue
        mname = next((m for m in out['catalog'][gname] if norm(m) == mnorm), None)
        if not mname: continue
        fn = getattr(groups[gname], mname)
        if required_args(fn):
            out['errors'][f'{gname}.{mname}'] = 'needs args, skipped'; continue
        try: out['data'][f'{gname}.{mname}'] = fn()
        except Exception as e: out['errors'][f'{gname}.{mname}'] = f'{type(e).__name__}: {str(e)[:100]}'

path = Path.home() / 'e5577' / 'dump.json'
path.write_text(json.dumps(redact(out), ensure_ascii=False, separators=(',', ':'), default=str), encoding='utf-8')
print(f'OK: {path} ({path.stat().st_size} bytes), calls ok={len(out["data"])}, errors={len(out["errors"])}')
