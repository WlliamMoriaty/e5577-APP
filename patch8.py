#!/usr/bin/env python3
"""Update 8: fix the login box layout — password field full width, show/hide button underneath it.
Run from ~/e5577:  python patch8.py   (keeps .bak, safe to re-run)"""
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


patch(D / 'index.html', [
    (""".pwrow{display:flex;gap:8px}
.pwrow input{flex:1}
#loginerr{color:var(--warn);font-size:13px;min-height:18px;margin-top:10px}
#loginbox .btn{width:100%;margin-top:14px}""",
     """.pwrow{display:flex;flex-direction:column;gap:8px}
#loginshow{align-self:flex-start;padding:6px 4px}
#loginerr{color:var(--warn);font-size:13px;min-height:18px;margin-top:10px}
#loginsubmit{width:100%;margin-top:14px}"""),
    ('<div class="pwrow"><input id="loginpw" class="ltr" type="password" autocomplete="current-password"><button type="button" class="btn ghost" id="loginshow">إظهار</button></div>',
     '<div class="pwrow"><input id="loginpw" class="ltr" type="password" autocomplete="current-password"><button type="button" class="lnk" id="loginshow">إظهار كلمة السر</button></div>'),
], 'loginsubmit{width:100%')
