import time
from huawei_lte_api.Connection import Connection

URL = 'http://192.168.8.1/'
user = input('Username [admin]: ').strip() or 'admin'
pw = input('Password (visible): ')

def ussd_send(c, text):
    c.post_get('ussd/send', {'content': text, 'codeType': 'CodeType', 'timeout': None})
    for _ in range(40):
        time.sleep(1)
        try:
            r = c.get('ussd/get')
        except Exception:
            continue
        if r and str(r.get('content', '')).strip():
            return r['content']
    return None

with Connection(URL, username=user, password=pw) as c:
    print('status before:', c.get('ussd/status'))
    msg = input('USSD code: ').strip()
    try:
        while msg:
            reply = ussd_send(c, msg)
            print('\n--- reply ---')
            print(reply if reply else '(no reply / timeout)')
            print('-------------')
            if not reply:
                break
            msg = input('Reply (empty = end session): ').strip()
    finally:
        try:
            c.get('ussd/release')
        except Exception as e:
            print('release:', e)
