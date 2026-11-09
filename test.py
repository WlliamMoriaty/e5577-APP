from huawei_lte_api.Client import Client
from huawei_lte_api.Connection import Connection
from huawei_lte_api.exceptions import LoginErrorUsernamePasswordWrongException

user = input('Username [admin]: ').strip() or 'admin'
pw = input('Password (visible): ')
print(f'Sending -> user=[{user}] password=[{pw}] length={len(pw)}')

try:
    with Connection('http://192.168.8.1/', username=user, password=pw) as c:
        cl = Client(c)
        print(cl.device.information())
        print(cl.monitoring.status())
except LoginErrorUsernamePasswordWrongException:
    print('Login failed: wrong username or password (or login is temporarily locked).')
