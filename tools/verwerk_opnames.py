#!/usr/bin/env python3
"""Zet de zipbestanden van opname.html om naar mp3's voor het spel.

Gebruik:  python3 tools/verwerk_opnames.py balimba-opnames-level1.zip [meer.zip ...]

Per opname:
  1. de spraak opzoeken (alles boven de ruis), met wat marge ervoor en erna,
     zodat zachte beginklanken (z, s, f) en eindklanken (st, kst) heel blijven;
  2. de klik van de spatiebalk aan het begin overslaan;
  3. het volume gelijktrekken;
  4. opslaan als mono mp3 in audio/.
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

RUIS_DB = -50        # alles hierboven telt als geluid
VOOR, NA = 0.10, 0.22   # marge voor en na de spraak, in seconden
DOEL_GEMIDDELD, DOEL_PIEK = -20.0, -1.5


def ffmpeg(*args):
    return subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", *args], capture_output=True, text=True)


def duur(pad):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(pad)],
                       capture_output=True, text=True)
    return float(r.stdout.strip())


def spraakgrenzen(pad):
    """Begin en eind van de spraak in seconden, of None als er niets te horen is."""
    totaal = duur(pad)
    uit = ffmpeg("-i", str(pad), "-af", f"silencedetect=noise={RUIS_DB}dB:d=0.04", "-f", "null", "-").stderr
    stiltes, start = [], None
    for soort, t in re.findall(r"silence_(start|end): (-?[\d.]+)", uit):
        if soort == "start":
            start = max(0.0, float(t))
        elif start is not None:
            stiltes.append((start, float(t)))
            start = None
    if start is not None:
        stiltes.append((start, totaal))
    # Wat tussen de stiltes ligt, is geluid.
    geluid, vorige = [], 0.0
    for a, b in stiltes:
        if a - vorige > 0.01:
            geluid.append((vorige, a))
        vorige = b
    if totaal - vorige > 0.01:
        geluid.append((vorige, totaal))
    # De klik van de spatiebalk: een kort tikje helemaal aan het begin of eind.
    geluid = [(a, b) for a, b in geluid
              if not (a < 0.25 and b - a < 0.22) and not (totaal - b < 0.10 and b - a < 0.08)]
    if not geluid:
        return None
    return max(0.0, geluid[0][0] - VOOR), min(totaal, geluid[-1][1] + NA)


def verwerk_bestand(bron, doel):
    grenzen = spraakgrenzen(bron)
    if not grenzen:
        return "geen spraak gevonden"
    a, b = grenzen
    knip = f"atrim={a:.3f}:{b:.3f},asetpts=PTS-STARTPTS"
    meting = ffmpeg("-i", str(bron), "-af", knip + ",volumedetect", "-f", "null", "-").stderr
    gem = float(re.search(r"mean_volume: (-?[\d.]+)", meting).group(1))
    piek = float(re.search(r"max_volume: (-?[\d.]+)", meting).group(1))
    versterk = min(DOEL_GEMIDDELD - gem, DOEL_PIEK - piek)
    lengte = b - a
    keten = (f"{knip},volume={versterk:.1f}dB,"
             f"afade=t=in:d=0.02,afade=t=out:st={max(0.0, lengte - 0.06):.3f}:d=0.06")
    doel.parent.mkdir(parents=True, exist_ok=True)
    r = ffmpeg("-y", "-loglevel", "error", "-i", str(bron), "-af", keten,
               "-ac", "1", "-ar", "44100", "-b:a", "64k", str(doel))
    if r.returncode != 0 or not doel.exists() or doel.stat().st_size < 500:
        return "omzetten mislukt"
    return None


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
            fout = verwerk_bestand(bron, AUDIO / soort / f"{naam}.mp3")
            if fout:
                mislukt.append(f"{info.filename}: {fout}")
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
