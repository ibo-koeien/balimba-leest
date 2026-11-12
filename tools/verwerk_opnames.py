#!/usr/bin/env python3
"""Zet de zipbestanden van opname.html om naar mp3's voor het spel.

Gebruik:  python3 tools/verwerk_opnames.py balimba-opnames-level1.zip [meer.zip ...]

Per opname: stilte aan begin en eind eraf, volume gelijktrekken, mono mp3.
Daarna wordt data/opnames.json bijgewerkt met alles wat in audio/ staat.
"""
import json
import pathlib
import re
import subprocess
import sys
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
AUDIO = ROOT / "audio"
NAAM = re.compile(r"^(woorden|zinnen)/([a-z0-9-]+)\.(m4a|webm|ogg|wav|mp3)$")
FILTER = (
    "silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.08,"
    "areverse,"
    "silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.18,"
    "areverse,"
    "loudnorm=I=-17:TP=-1.5:LRA=11"
)


def verwerk(zip_pad):
    gedaan, mislukt = 0, []
    with zipfile.ZipFile(zip_pad) as z, tempfile.TemporaryDirectory() as tmp:
        for info in z.infolist():
            m = NAAM.match(info.filename)
            if not m:
                continue
            soort, naam, ext = m.groups()
            bron = pathlib.Path(tmp) / f"in.{ext}"
            bron.write_bytes(z.read(info))
            doel = AUDIO / soort / f"{naam}.mp3"
            doel.parent.mkdir(parents=True, exist_ok=True)
            r = subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(bron), "-af", FILTER,
                 "-ac", "1", "-ar", "44100", "-b:a", "64k", str(doel)],
                capture_output=True, text=True,
            )
            if r.returncode != 0 or not doel.exists() or doel.stat().st_size < 500:
                mislukt.append(info.filename)
            else:
                gedaan += 1
    return gedaan, mislukt


def schrijf_lijst():
    lijst = {
        soort: sorted(p.stem for p in (AUDIO / soort).glob("*.mp3")) if (AUDIO / soort).exists() else []
        for soort in ("woorden", "zinnen")
    }
    (ROOT / "data" / "opnames.json").write_text(json.dumps(lijst, ensure_ascii=False, indent=2) + "\n")
    return lijst


if __name__ == "__main__":
    for pad in sys.argv[1:]:
        n, fout = verwerk(pad)
        print(f"{pad}: {n} verwerkt" + (f", mislukt: {fout}" if fout else ""))
    lijst = schrijf_lijst()
    print(f"opnames.json: {len(lijst['woorden'])} woorden, {len(lijst['zinnen'])} zinnen")
