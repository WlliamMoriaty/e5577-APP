#!/usr/bin/env python3
"""Update 5: more raw endpoints, nested payloads, DHCP lock-out guard, host names in the MAC filter,
and loading advanced.js. Run from ~/e5577:  python patch5.py   (keeps .bak copies, safe to re-run)"""
import shutil
from pathlib import Path

D = Path(__file__).resolve().parent / 'ui'


def patch(path, edits, marker):
    t = path.read_text(encoding='utf-8')
    if marker in t:
        print(path.name, 'already updated')
        return
    for old, new in edits:
        if t.count(old) != 1:
            raise SystemExit(f'STOP: expected text not found exactly once in {path.name}: {old[:60]!r}\nNothing was changed.')
        t = t.replace(old, new)
    shutil.copy(path, str(path) + '.bak')
    path.write_text(t, encoding='utf-8')
    print(path.name, 'updated')


patch(D / 'server.py', [
    ("""RAW_GET = {'wlan/basic-settings', 'wlan/mac-filter', 'net/plmn-list', 'net/register'}
RAW_SET = {'wlan/basic-settings', 'wlan/mac-filter', 'net/register'}""",
     """RAW_SET = {'wlan/basic-settings', 'wlan/mac-filter', 'net/register', 'dialup/connection', 'security/firewall-switch',
           'security/dmz', 'security/sip', 'security/nat', 'security/virtual-servers', 'dhcp/settings'}
RAW_GET = RAW_SET | {'net/plmn-list'}"""),
    ("""def raw(p, d):""",
     '''def _clean(v):
    """Keep nested dict/list structure, but turn every leaf into a string (what the router expects)."""
    if isinstance(v, dict):
        return {str(k): _clean(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_clean(x) for x in v]
    return '' if v is None else str(v)


def raw(p, d):'''),
    ("if p not in RAW_SET or not isinstance(d, dict) or len(d) > 80:",
     "if p not in RAW_SET or not isinstance(d, dict) or len(json.dumps(d)) > 20000:"),
    ("""    d = {str(k): ('' if v is None else str(v)) for k, v in d.items()}
    call(lambda cl, c: cl.monitoring.status())""",
     """    d = _clean(d)
    if p == 'dhcp/settings' and not (d.get('DhcpIPAddress') == '192.168.8.1' and d.get('DhcpStatus') == '1'
                                     and d.get('DhcpLanNetmask') == '255.255.255.0'):
        return {'error': 'تغيير عنوان الراوتر أو إيقاف DHCP غير مسموح (قد يقفل عليك الوصول)'}
    call(lambda cl, c: cl.monitoring.status())
    if p == 'wlan/mac-filter':  # the original UI stores a host name next to every blocked MAC
        names = {str(h.get('MacAddress', '')).upper(): h.get('HostName') or '' for h in as_list(
            (((call(lambda cl, c: cl.wlan.host_list()) or {}).get('Hosts')) or {}).get('Host'))}
        for i in range(10):
            mac = str(d.get(f'WifiMacFilterMac{i}', '')).upper()
            d[f'wifihostname{i}'] = names.get(mac, '') if mac else ''"""),
], '_clean')

patch(D / 'index.html', [
    ('<script src="networks.js"></script>', '<script src="networks.js"></script>\n<script src="advanced.js"></script>'),
], 'advanced.js')
