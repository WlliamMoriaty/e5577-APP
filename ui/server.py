#!/usr/bin/env python3
"""E5577 local bridge. Serves the UI files and relays whitelisted calls to the router.

    python ui/server.py         -> http://127.0.0.1:8080  (this laptop only)
    python ui/server.py --lan   -> also phones on the router Wi-Fi (needs the printed access code)

The router username/password are entered in the page itself (a login box appears
automatically on first use) — nothing to type in this terminal.
Optional: ROUTER_PASS pre-fills the password (user 'admin') so the page logs in automatically.
"""
import argparse, http.client, json, os, re, secrets, socket, threading, time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from huawei_lte_api.Client import Client
from huawei_lte_api.Connection import Connection
from huawei_lte_api.exceptions import LoginErrorUsernamePasswordWrongException
try:
    from huawei_lte_api.exceptions import LoginErrorUsernamePasswordOverrunException
except ImportError:
    LoginErrorUsernamePasswordOverrunException = LoginErrorUsernamePasswordWrongException
LOGIN_ERRORS = (LoginErrorUsernamePasswordWrongException, LoginErrorUsernamePasswordOverrunException)

ROOT = Path(__file__).resolve().parent
ROUTER = 'http://192.168.8.1/'
SPEED_BASE = os.environ.get('SPEED_BASE', 'https://speed.cloudflare.com')
LOCK = threading.RLock()
S = {'conn': None, 'cl': None, 'user': 'admin', 'pw': None}  # pw None = not logged in yet
TOKEN = None
LOCAL_HOSTS = ('127.0.0.1', 'localhost')
USSD_OK = re.compile(r'^[0-9*#]{1,64}$')
PHONE_OK = re.compile(r'^\+?[0-9]{3,16}$')
JS_OK = re.compile(r'^/[a-z0-9_]+\.js$')

READ = set('''device.information device.signal net.cell_info net.net_mode net.net_mode_list
net.current_plmn dial_up.profiles dial_up.connection dial_up.mobile_dataswitch dhcp.settings
wlan.basic_settings wlan.security_settings wlan.host_list monitoring.month_statistics
monitoring.start_date monitoring.traffic_statistics monitoring.status security.upnp sms.sms_count
sms.config diagnosis.diagnose_ping cwmp.basic_info d_dns.get_status usb_storage.fsstatus
usb_storage.usbaccount sd_card.share_account monitoring.daily_data_limit'''.split())
WRITE = set('''dial_up.set_mobile_dataswitch dial_up.set_default_profile dial_up.create_profile
dial_up.delete_profile net.set_net_mode monitoring.set_clear_traffic monitoring.set_start_date
wlan.set_basic_settings wlan.set_security_settings security.set_upnp sms.send_sms sms.delete_sms
sms.set_read diagnosis.set_diagnose_ping device.set_control'''.split())
RAW_SET = {'wlan/basic-settings', 'wlan/mac-filter', 'net/register', 'dialup/connection', 'security/firewall-switch',
           'security/dmz', 'security/sip', 'security/nat', 'security/virtual-servers', 'dhcp/settings',
           'ddns/ddns-list', 'timerule/timerule', 'cwmp/cwmp-cfg'}
RAW_GET = RAW_SET | {'net/plmn-list'}


class AuthRequired(Exception):
    """Raised whenever the router session isn't logged in yet; the browser shows a login box for this."""


def logout():
    c, S['conn'], S['cl'] = S['conn'], None, None
    if c:
        try:
            c.__exit__(None, None, None)
        except Exception:
            pass


def login():
    with LOCK:
        logout()
        if not S['pw']:
            raise AuthRequired
        c = Connection(ROUTER, username=S['user'], password=S['pw'])
        S['conn'], S['cl'] = c, Client(c)


def call(fn, retry=True):
    """Run fn(client, conn). Logs in first if needed; on a stale session, re-logs in once."""
    with LOCK:
        if not S['conn']:
            login()  # AuthRequired or a login exception propagates as-is, no retry
        try:
            return fn(S['cl'], S['conn'])
        except Exception:
            if not retry:
                raise
            logout()
            login()
            return fn(S['cl'], S['conn'])


def do_login(user, pw):
    user = (user or 'admin').strip() or 'admin'
    pw = pw or ''
    if not pw:
        return {'error': 'أدخل كلمة السر'}
    with LOCK:
        logout()
        S['user'], S['pw'] = user, pw
    try:
        call(lambda cl, c: cl.device.information())
        return {'ok': True}
    except LOGIN_ERRORS as e:
        S['pw'] = None
        overrun = 'Overrun' in type(e).__name__
        return {'error': 'الدخول مقفل مؤقتاً بعد محاولات فاشلة، انتظر بضع دقائق' if overrun
                else 'اسم المستخدم أو كلمة السر غير صحيحة'}
    except Exception as e:
        S['pw'] = None
        return {'error': f'{type(e).__name__}: {e}'[:200]}


def as_list(x):
    return x if isinstance(x, list) else ([x] if x else [])


def conv(a):
    """'enum:ControlModeEnum.REBOOT' -> the real enum member (device/sms enums only)."""
    if isinstance(a, str) and a.startswith('enum:'):
        import huawei_lte_api.enums.device as ed
        import huawei_lte_api.enums.sms as es
        name, member = a[5:].split('.', 1)
        return getattr(getattr(es, name, None) or getattr(ed, name), member)
    return a


def rpc(m, a, k):
    if m not in READ | WRITE:
        return {'error': 'غير مسموح: ' + m}
    if m == 'device.set_control' and a != ['enum:ControlModeEnum.REBOOT']:
        return {'error': 'مسموح بإعادة التشغيل فقط'}
    if m == 'sms.send_sms':
        nums, text = (a + ['', ''])[:2]
        if not (isinstance(nums, list) and nums and all(PHONE_OK.match(str(n)) for n in nums)):
            return {'error': 'رقم غير صالح'}
        if not str(text).strip() or len(str(text)) > 700:
            return {'error': 'نص غير صالح'}
    g, f = m.split('.')
    a, k = [conv(x) for x in a], {n: conv(v) for n, v in k.items()}
    if m in WRITE:
        call(lambda cl, c: cl.monitoring.status())  # make sure the session is alive first
    r = call(lambda cl, c: getattr(getattr(cl, g), f)(*a, **k), retry=m in READ)
    if m == 'device.set_control':
        logout()
    return {'r': r}


def _clean(v):
    """Keep nested dict/list structure, but turn every leaf into a string (what the router expects)."""
    if isinstance(v, dict):
        return {str(k): _clean(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_clean(x) for x in v]
    return '' if v is None else str(v)


def raw(p, d):
    """GET (d is None) or POST (d is a dict) one of the whitelisted original-WebUI endpoints."""
    if d is None:
        if p not in RAW_GET:
            return {'error': 'غير مسموح: ' + p}
        return {'r': call(lambda cl, c: c.get(p))}
    if p not in RAW_SET or not isinstance(d, dict) or len(json.dumps(d)) > 20000:
        return {'error': 'غير مسموح: ' + p}
    d = _clean(d)
    if p == 'dhcp/settings' and not (d.get('DhcpIPAddress') == '192.168.8.1' and d.get('DhcpStatus') == '1'
                                     and d.get('DhcpLanNetmask') == '255.255.255.0'):
        return {'error': 'تغيير عنوان الراوتر أو إيقاف DHCP غير مسموح (قد يقفل عليك الوصول)'}
    if p == 'ddns/ddns-list':
        lst = ((d.get('ddnss') or {}).get('ddns')) or []
        if not isinstance(lst, list) or len(lst) > 4:
            return {'error': 'عدد غير صالح من إعدادات DDNS'}
    call(lambda cl, c: cl.monitoring.status())
    if p == 'wlan/mac-filter':  # the original UI stores a host name next to every blocked MAC
        names = {str(h.get('MacAddress', '')).upper(): h.get('HostName') or '' for h in as_list(
            (((call(lambda cl, c: cl.wlan.host_list()) or {}).get('Hosts')) or {}).get('Host'))}
        for i in range(10):
            mac = str(d.get(f'WifiMacFilterMac{i}', '')).upper()
            d[f'wifihostname{i}'] = names.get(mac, '') if mac else ''
    return {'r': call(lambda cl, c: c.post_set(p, d), retry=False)}


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('192.168.8.1', 80))
        return s.getsockname()[0]
    except OSError:
        return '127.0.0.1'
    finally:
        s.close()


def whoami(ip):
    """Which Wi-Fi client is the caller? Used to stop you from blocking your own device."""
    if ip in ('127.0.0.1', '::1'):
        ip = lan_ip()
    hosts = as_list((((call(lambda cl, c: cl.wlan.host_list()) or {}).get('Hosts')) or {}).get('Host'))
    for h in hosts:
        if h.get('IpAddress') == ip:
            return {'ip': ip, 'mac': h.get('MacAddress'), 'name': h.get('HostName')}
    return {'ip': ip, 'mac': None, 'name': None}


def get_status():
    def f(cl, c):
        mon, tr = cl.monitoring.status(), cl.monitoring.traffic_statistics()
        dev, plmn = cl.device.information(), cl.net.current_plmn()
        hosts = (cl.wlan.host_list() or {}).get('Hosts') or {}
        try:
            n = cl.sms.sms_count()
            unread = int(n.get('LocalUnread') or 0) + int(n.get('SimUnread') or 0)
        except Exception:
            unread = 0
        keep = ('ConnectionStatus', 'SignalIcon', 'CurrentNetworkType', 'BatteryPercent',
                'CurrentWifiUser', 'TotalWifiUser', 'PrimaryDns')
        return {
            'device': {k: dev.get(k) for k in ('DeviceName', 'SoftwareVersion', 'WebUIVersion')},
            'mon': {k: mon.get(k) for k in keep},
            'operator': plmn.get('FullName'),
            'traffic': tr,
            'hosts': [{'name': h.get('HostName'), 'ip': h.get('IpAddress'), 'mac': h.get('MacAddress')}
                      for h in as_list(hosts.get('Host'))],
            'data_on': str(cl.dial_up.mobile_dataswitch().get('dataswitch')) == '1',
            'unread': unread,
        }
    return call(f)


def sms_all():
    from huawei_lte_api.enums.sms import BoxTypeEnum

    def f(cl, c):
        out, seen = [], set()
        for name, d in (('LOCAL_INBOX', 'in'), ('SIM_INBOX', 'in'), ('LOCAL_SENT', 'out'), ('SIM_SENT', 'out')):
            box = getattr(BoxTypeEnum, name, None)
            if box is None:
                continue
            for page in range(1, 11):
                try:
                    r = cl.sms.get_sms_list(page=page, box_type=box, read_count=50)
                except Exception:
                    break
                ms = as_list(((r or {}).get('Messages') or {}).get('Message'))
                for m in ms:
                    key = (name, m.get('Index'))
                    if key in seen:
                        continue
                    seen.add(key)
                    out.append({'id': m.get('Index'), 'phone': m.get('Phone') or '', 'text': m.get('Content') or '',
                                'date': m.get('Date') or '', 'dir': d, 'unread': m.get('Smstat') == '0' and d == 'in'})
                if len(ms) < 50:
                    break
        out.sort(key=lambda m: m['date'])
        return {'messages': out}
    return call(f)


def ussd(content):
    if not USSD_OK.match(content):
        return {'error': 'الكود يحتوي على أرقام و * و # فقط'}
    call(lambda cl, c: c.get('ussd/status'))

    def f(cl, c):
        c.post_get('ussd/send', {'content': content, 'codeType': 'CodeType', 'timeout': None})
        for _ in range(40):
            time.sleep(1)
            try:
                r = c.get('ussd/get')
            except Exception:
                continue
            if r and str(r.get('content', '')).strip():
                return {'reply': r['content']}
        return {'error': 'لا يوجد رد من الشبكة (انتهت المهلة)'}
    return call(f, retry=False)  # never resend a USSD code automatically


def ussd_release():
    call(lambda cl, c: c.get('ussd/release'))
    return {'ok': True}


# ---------- speed-test helpers (used only when the browser cannot reach the test host itself) ----------
def _conn():
    u = urllib.parse.urlparse(SPEED_BASE)
    cls = http.client.HTTPSConnection if u.scheme == 'https' else http.client.HTTPConnection
    return cls(u.netloc, timeout=20)


UA = {'User-Agent': 'Mozilla/5.0'}


def speed_ping():
    c, ms = _conn(), []
    for _ in range(11):
        t = time.perf_counter()
        c.request('GET', '/__down?bytes=0', headers=UA)
        c.getresponse().read()
        ms.append((time.perf_counter() - t) * 1000)
    return {'ms': ms[1:]}  # the first sample includes the TLS handshake


def speed_up(n):
    n = max(1_000_000, min(int(n), 40_000_000))
    per = n // 4

    def one(_):
        c = _conn()
        c.request('POST', '/__up', body=os.urandom(per), headers={**UA, 'Content-Type': 'application/octet-stream'})
        c.getresponse().read()
    t = time.perf_counter()
    with ThreadPoolExecutor(4) as ex:
        list(ex.map(one, range(4)))
    dt = time.perf_counter() - t
    return {'bps': per * 4 / dt, 'bytes': per * 4}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, code, body, ctype='application/json; charset=utf-8'):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False, default=str).encode()
        self.send_response(code)
        for k, v in (('Content-Type', ctype), ('Content-Length', str(len(data))),
                     ('Cache-Control', 'no-store'), ('X-Frame-Options', 'DENY')):
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def gate(self):
        host = (self.headers.get('Host') or '').rsplit(':', 1)[0]
        if TOKEN is None and host not in LOCAL_HOSTS:
            self.reply(403, {'error': 'host not allowed'})
            return False
        return True

    def authed(self):
        if TOKEN is None or secrets.compare_digest(self.headers.get('X-Token', ''), TOKEN):
            return True
        self.reply(401, {'error': 'token'})
        return False

    def run(self, fn):
        try:
            self.reply(200, fn())
        except AuthRequired:
            self.reply(401, {'error': 'router_login_required'})
        except LOGIN_ERRORS:
            S['pw'] = None
            self.reply(401, {'error': 'router_login_failed'})
        except Exception as e:
            self.reply(500, {'error': f'{type(e).__name__}: {e}'[:200]})

    def stream_down(self, n):
        n = max(0, min(n, 100_000_000))
        c = _conn()
        c.request('GET', f'/__down?bytes={n}', headers=UA)
        r = c.getresponse()
        self.send_response(200)
        for k, v in (('Content-Type', 'application/octet-stream'), ('Cache-Control', 'no-store')):
            self.send_header(k, v)
        self.end_headers()
        while True:
            chunk = r.read(65536)
            if not chunk:
                break
            self.wfile.write(chunk)

    def do_GET(self):
        if not self.gate():
            return
        u = urllib.parse.urlparse(self.path)
        if u.path in ('/', '/index.html'):
            return self.reply(200, (ROOT / 'index.html').read_bytes(), 'text/html; charset=utf-8')
        if JS_OK.match(u.path) and (ROOT / u.path[1:]).is_file():
            return self.reply(200, (ROOT / u.path[1:]).read_bytes(), 'application/javascript; charset=utf-8')
        if not self.authed():
            return
        if u.path == '/api/speed/down':
            try:
                return self.stream_down(int(urllib.parse.parse_qs(u.query).get('bytes', ['10000000'])[0]))
            except Exception:
                return
        fn = {'/api/status': get_status, '/api/sms/all': sms_all, '/api/speed/ping': speed_ping,
              '/api/whoami': lambda: whoami(self.client_address[0])}.get(u.path)
        if not fn:
            return self.reply(404, {'error': 'not found'})
        self.run(fn)

    def do_POST(self):
        if not self.gate() or not self.authed():
            return
        # JSON content-type forces a CORS preflight, so other websites cannot POST here
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.reply(415, {'error': 'json only'})
        try:
            b = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}')
        except ValueError:
            return self.reply(400, {'error': 'bad json'})
        if self.path == '/api/login':
            return self.reply(200, do_login(b.get('user'), b.get('pw')))
        fn = {'/api/rpc': lambda: rpc(str(b.get('m', '')), list(b.get('a') or []), dict(b.get('k') or {})),
              '/api/raw': lambda: raw(str(b.get('p', '')), b.get('d')),
              '/api/ussd': lambda: ussd(str(b.get('content', '')).strip()),
              '/api/ussd/release': ussd_release}.get(self.path)
        if not fn:
            return self.reply(404, {'error': 'not found'})
        self.run(fn)


def main():
    global TOKEN
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8080)
    ap.add_argument('--lan', action='store_true', help='also serve phones on the router Wi-Fi')
    a = ap.parse_args()

    if os.environ.get('ROUTER_PASS'):
        S['user'], S['pw'] = 'admin', os.environ['ROUTER_PASS']
        try:
            login()
            print('Logged in to the router (from ROUTER_PASS).')
        except Exception:
            S['pw'] = None
            print('ROUTER_PASS login failed; log in from the page instead.')

    if a.lan:
        TOKEN = secrets.token_urlsafe(6)
    srv = ThreadingHTTPServer(('0.0.0.0' if a.lan else '127.0.0.1', a.port), Handler)
    print(f'Open: http://127.0.0.1:{a.port}')
    if a.lan:
        print(f'Phone: http://{lan_ip()}:{a.port}   access code: {TOKEN}')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        logout()


if __name__ == '__main__':
    main()
