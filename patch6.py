#!/usr/bin/env python3
"""Update 6: scheduled access, CWMP status, DDNS, storage-sharing status (extra.js).
Run from ~/e5577:  python patch6.py   (keeps .bak copies, safe to re-run)"""
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
    ("""READ = set('''device.information device.signal net.cell_info net.net_mode net.net_mode_list
net.current_plmn dial_up.profiles dial_up.connection dial_up.mobile_dataswitch dhcp.settings
wlan.basic_settings wlan.security_settings wlan.host_list monitoring.month_statistics
monitoring.start_date monitoring.traffic_statistics monitoring.status security.upnp sms.sms_count
sms.config diagnosis.diagnose_ping'''.split())""",
     """READ = set('''device.information device.signal net.cell_info net.net_mode net.net_mode_list
net.current_plmn dial_up.profiles dial_up.connection dial_up.mobile_dataswitch dhcp.settings
wlan.basic_settings wlan.security_settings wlan.host_list monitoring.month_statistics
monitoring.start_date monitoring.traffic_statistics monitoring.status security.upnp sms.sms_count
sms.config diagnosis.diagnose_ping cwmp.basic_info d_dns.get_status usb_storage.fsstatus
usb_storage.usbaccount sd_card.share_account monitoring.daily_data_limit'''.split())"""),
    ("""RAW_SET = {'wlan/basic-settings', 'wlan/mac-filter', 'net/register', 'dialup/connection', 'security/firewall-switch',
           'security/dmz', 'security/sip', 'security/nat', 'security/virtual-servers', 'dhcp/settings'}""",
     """RAW_SET = {'wlan/basic-settings', 'wlan/mac-filter', 'net/register', 'dialup/connection', 'security/firewall-switch',
           'security/dmz', 'security/sip', 'security/nat', 'security/virtual-servers', 'dhcp/settings',
           'ddns/ddns-list', 'timerule/timerule', 'cwmp/cwmp-cfg'}"""),
    ("""    if p == 'dhcp/settings' and not (d.get('DhcpIPAddress') == '192.168.8.1' and d.get('DhcpStatus') == '1'
                                     and d.get('DhcpLanNetmask') == '255.255.255.0'):
        return {'error': 'تغيير عنوان الراوتر أو إيقاف DHCP غير مسموح (قد يقفل عليك الوصول)'}""",
     """    if p == 'dhcp/settings' and not (d.get('DhcpIPAddress') == '192.168.8.1' and d.get('DhcpStatus') == '1'
                                     and d.get('DhcpLanNetmask') == '255.255.255.0'):
        return {'error': 'تغيير عنوان الراوتر أو إيقاف DHCP غير مسموح (قد يقفل عليك الوصول)'}
    if p == 'ddns/ddns-list':
        lst = ((d.get('ddnss') or {}).get('ddns')) or []
        if not isinstance(lst, list) or len(lst) > 4:
            return {'error': 'عدد غير صالح من إعدادات DDNS'}"""),
], 'ddns/ddns-list')

patch(D / 'index.html', [
    ('<script src="advanced.js"></script>', '<script src="advanced.js"></script>\n<script src="extra.js"></script>'),
], 'extra.js')
