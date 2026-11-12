#!/usr/bin/env python3
"""Zet een nieuw versienummer achter de css- en js-verwijzingen in index.html.

Draai dit voor elke commit die het spel wijzigt. Zonder nieuw nummer kan een browser
de nieuwe index.html combineren met een oude stijl.css of spel.js uit zijn cache.
"""
import pathlib
import re
import time

pad = pathlib.Path(__file__).resolve().parent.parent / "index.html"
versie = time.strftime("%Y%m%d%H%M")
tekst = pad.read_text()
tekst, n = re.subn(r'((?:css/stijl\.css|js/spel\.js))(?:\?v=\d+)?"', rf'\1?v={versie}"', tekst)
tekst, m = re.subn(r'window\.BALIMBA_VERSIE = "\d*"', f'window.BALIMBA_VERSIE = "{versie}"', tekst)
assert n == 2 and m == 1, (n, m)
pad.write_text(tekst)
print("versie", versie)
