// Balimba leest – een ronde woorden lezen, samen of alleen.
// De woorden staan in data/woorden.json, de instellingen in data/instellingen.json.

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // Opslag op de iPad zelf. Mag mislukken (privévenster): het spel werkt dan gewoon door.
  const opslag = {
    lees(sleutel, anders) {
      try { const v = localStorage.getItem(sleutel); return v == null ? anders : JSON.parse(v); }
      catch (e) { return anders; }
    },
    schrijf(sleutel, waarde) {
      try { localStorage.setItem(sleutel, JSON.stringify(waarde)); } catch (e) { /* geen opslag */ }
    }
  };

  let woorden = null;       // inhoud van woorden.json
  let inst = null;          // inhoud van instellingen.json
  let opnames = { woorden: [], zinnen: [] };   // inhoud van opnames.json
  let stickers = { perLevel: 5, keuzePerVel: 6, stickers: [] };   // inhoud van stickers.json
  let tocht = null;         // inhoud van tocht.json: waar de stapstenen en de plekken liggen
  let plek = opslag.lees("balimba.plek", { level: 0, ronde: 0 });
  let st = null;            // toestand van de lopende ronde

  // ---------- Geluid ----------
  // Voorzeggen gebeurt met eigen opnames uit audio/. Welke er zijn, staat in data/opnames.json.
  // De computerstem is alleen een terugval en staat standaard uit (instellingen.json).

  let audio = null;
  function geluidAan() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
    } catch (e) { /* geen geluid */ }
    return audio;
  }

  const buffers = new Map();   // pad -> Promise<AudioBuffer | null>
  function haalOp(pad) {
    if (!buffers.has(pad)) {
      buffers.set(pad, fetch(pad)
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then((b) => new Promise((ok, fout) => geluidAan().decodeAudioData(b, ok, fout)))
        .catch(() => null));
    }
    return buffers.get(pad);
  }

  let bron = null;
  function stil() {
    if (bron) { try { bron.stop(); } catch (e) { /* al gestopt */ } bron = null; }
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }
  async function speel(pad) {
    const buf = await haalOp(pad);
    if (!buf || !geluidAan()) return 0;
    stil();
    bron = audio.createBufferSource();
    bron.buffer = buf;
    bron.connect(audio.destination);
    bron.start();
    return buf.duration;
  }

  let stem = null;
  function kiesStem() {
    if (!("speechSynthesis" in window)) return;
    const stemmen = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith("nl"));
    stem = stemmen.find((v) => v.lang === "nl-NL") || stemmen[0] || null;
  }
  if ("speechSynthesis" in window) {
    kiesStem();
    speechSynthesis.addEventListener("voiceschanged", kiesStem);
  }
  function computerstem(tekst, tempo) {
    if (!inst.computerstem || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(tekst);
    u.lang = inst.stem.taal;
    if (stem) u.voice = stem;
    u.rate = tempo;
    speechSynthesis.speak(u);
  }

  const heeftWoord = (w) => opnames.woorden.includes(w);
  const padWoord = (w) => "audio/woorden/" + w + ".mp3";

  function zegWoord(w) {
    if (heeftWoord(w)) speel(padWoord(w)); else computerstem(w, inst.stem.tempoWoord);
  }
  // soort: "nogEens" of "rondeKlaar" uit instellingen.json
  function zegZin(soort) {
    // Kies bij voorkeur een zin die al is ingesproken.
    const alle = inst.zinnen[soort] || [];
    const metOpname = alle.filter((x) => opnames.zinnen.includes(x.id));
    const z = kies(metOpname.length ? metOpname : alle);
    if (!z) return Promise.resolve(0);
    if (opnames.zinnen.includes(z.id)) return speel("audio/zinnen/" + z.id + ".mp3");   // geeft de duur in seconden
    computerstem(z.tekst, inst.stem.tempoZin);
    return Promise.resolve(0);
  }
  function laadVooraf(lijst) {
    for (const w of lijst) if (heeftWoord(w)) haalOp(padWoord(w));
    for (const soort of Object.keys(inst.zinnen)) for (const z of inst.zinnen[soort]) if (opnames.zinnen.includes(z.id)) haalOp("audio/zinnen/" + z.id + ".mp3");
  }

  function toon(reeks) {
    try {
      if (!geluidAan()) return;
      let t = audio.currentTime;
      for (const [hz, duur] of reeks) {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = "sine"; o.frequency.value = hz;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + duur);
        o.connect(g).connect(audio.destination);
        o.start(t); o.stop(t + duur + 0.02);
        t += duur * 0.6;
      }
    } catch (e) { /* geen geluid */ }
  }
  const belletje = () => toon([[880, 0.16], [1320, 0.28]]);
  const fanfare = () => toon([[660, 0.18], [880, 0.18], [1100, 0.18], [1320, 0.5]]);

  // ---------- Hulpjes ----------

  const kies = (lijst) => lijst[Math.floor(Math.random() * lijst.length)];

  function schud(lijst) {
    const a = lijst.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function toonScherm(naam) {
    for (const s of ["start", "spel", "klaar", "kiezen", "stickerbord", "finale"]) $(s).classList.toggle("verborgen", s !== naam);
  }

  function speelAf(el, klas) {
    el.classList.remove(klas);
    void el.offsetWidth;            // animatie opnieuw laten starten
    el.classList.add(klas);
  }

  // De eenhoorn en het katje die het bord vasthouden, reageren samen.
  function dieren(klas) {
    document.querySelectorAll("#spel .dier").forEach((d) => {
      d.classList.remove("blij", "moedig");
      void d.getBoundingClientRect();
      d.classList.add(klas);
      d.addEventListener("animationend", () => d.classList.remove(klas), { once: true });
    });
  }

  function aantalRondes(level) {
    return Math.ceil(woorden.levels[level].woorden.length / inst.rondeGrootte);
  }

  function rondeWoorden() {
    const n = inst.rondeGrootte;
    return woorden.levels[plek.level].woorden.slice(plek.ronde * n, (plek.ronde + 1) * n);
  }

  // Kan dit woord worden voorgezegd? Zo niet, dan slaat het spel het luisteren over.
  const kanHoren = (w) => inst.computerstem || heeftWoord(w);

  // ---------- Voortgang en stickers (alleen op dit apparaat bewaard) ----------
  // doorgang: welke rondes van een level in de lopende doorgang al gespeeld zijn
  // stickers: welke stickers er per level geplakt zijn (hoogstens stickers.perLevel)
  // tegoed:   verdiende stickers die nog niet geplakt zijn
  const haal = (naam) => opslag.lees("balimba." + naam, {});
  const zet = (naam, waarde) => opslag.schrijf("balimba." + naam, waarde);
  const rondeGedaan = (level, r) => (haal("doorgang")[level] || []).includes(r);
  const geplakt = (level) => haal("stickers")[level] || [];
  const tegoed = (level) => haal("tegoed")[level] || 0;
  function levelMetTegoed() {
    for (let i = 0; i < woorden.levels.length; i++) if (tegoed(i) > 0) return i;
    return -1;
  }

  // Eenmalig: rondes die al gespeeld waren voordat het stickerbord bestond, tellen mee.
  function neemOudeRondesMee() {
    if (opslag.lees("balimba.migratie1", false)) return;
    const oud = opslag.lees("balimba.gedaan", {}), d = haal("doorgang"), t = haal("tegoed");
    for (const sleutel of Object.keys(oud)) {
      const [l, r] = sleutel.split("-").map(Number);
      if (!woorden.levels[l] || !oud[sleutel]) continue;
      d[l] = d[l] || [];
      if (!d[l].includes(r)) d[l].push(r);
    }
    for (const l of Object.keys(d)) {
      if (d[l].length >= aantalRondes(Number(l))) { d[l] = []; t[l] = (t[l] || 0) + 1; }
    }
    zet("doorgang", d); zet("tegoed", t);
    opslag.schrijf("balimba.migratie1", true);
  }

  function maakVakjes(el, level, metDoel) {
    el.innerHTML = "";
    const lijst = geplakt(level);
    let doel = null;
    for (let i = 0; i < stickers.perLevel; i++) {
      const v = document.createElement("span");
      v.className = "vakje";
      if (lijst[i]) {
        v.classList.add("vol");
        const img = document.createElement("img");
        img.className = "sticker"; img.alt = ""; img.draggable = false;
        img.src = "img/stickers/" + lijst[i] + ".svg";
        v.appendChild(img);
      } else if (metDoel && !doel) { v.classList.add("doel"); doel = v; }
      el.appendChild(v);
    }
    return doel;
  }

  // Rij genummerde knoppen om een level of een ronde te kiezen. Een ster = die ronde is al eens gespeeld.
  function vulKiezer(el, aantal, actief, heeftSter, opKies) {
    el.innerHTML = "";
    for (let i = 0; i < aantal; i++) {
      const b = document.createElement("button");
      b.className = "kies" + (i === actief ? " actief" : "") + (heeftSter(i) ? " gedaan" : "");
      b.textContent = String(i + 1);
      b.addEventListener("click", () => opKies(i));
      el.appendChild(b);
    }
  }

  function bewaarPlek() {
    const perLevel = opslag.lees("balimba.rondePerLevel", {});
    perLevel[plek.level] = plek.ronde;
    opslag.schrijf("balimba.rondePerLevel", perLevel);
    opslag.schrijf("balimba.plek", plek);
  }
  function kiesLevel(i) {
    const perLevel = opslag.lees("balimba.rondePerLevel", {});
    plek = { level: i, ronde: Math.min(perLevel[i] || 0, aantalRondes(i) - 1) };
    bewaarPlek(); vulStart();
  }
  function kiesRonde(r) { plek.ronde = r; bewaarPlek(); vulStart(); }

  function vulStart() {
    const lvl = woorden.levels[plek.level];
    $("waar").textContent = lvl.naam;
    vulKiezer($("levels"), woorden.levels.length, plek.level, () => false, kiesLevel);
    vulKiezer($("rondes"), aantalRondes(plek.level), plek.ronde, (r) => rondeGedaan(plek.level, r), kiesRonde);
    maakVakjes($("ministickers"), plek.level, false);
    $("naarBord").classList.toggle("wenk", levelMetTegoed() >= 0);
    $("stilUitleg").classList.toggle("verborgen", rondeWoorden().every(kanHoren));
  }

  function maakSterren(el, aantal, vol) {
    el.innerHTML = "";
    for (let i = 0; i < aantal; i++) {
      const s = document.createElement("span");
      s.className = "ster" + (i < vol ? " vol" : "");
      s.textContent = "★";
      el.appendChild(s);
    }
  }

  // ---------- De ronde ----------

  function startRonde() {
    const lijst = rondeWoorden();
    st = {
      rij: schud(lijst).map((w) => ({ w, terug: false, sterGehad: false })),
      i: 0,
      sterren: 0,
      totaal: lijst.length,
      bezig: false
    };
    geluidAan();
    laadVooraf(lijst);
    maakSterren($("sterren"), st.totaal, 0);
    toonScherm("spel");
    toonWoord();
  }

  const nu = () => st.rij[st.i];

  function toonWoord() {
    const item = nu();
    // Zonder opname valt er niets te beluisteren: dan mag ze meteen zelf beoordelen.
    st.gehoord = !kanHoren(item.w);
    st.bezig = false;
    st.t0 = performance.now();

    const el = $("woord");
    el.textContent = item.w;
    el.className = "woord " + (item.w.length > 6 ? "lang" : "kort") + (item.terug ? " terug" : "");
    speelAf(el, "komt");
    zetKnoppen();
  }

  // Celeste leest het woord, luistert met het oortje en beoordeelt daarna zelf.
  function zetKnoppen() {
    const item = nu();
    const goed = $("goed"), opnieuw = $("opnieuw"), oor = $("oor");
    oor.classList.toggle("onzichtbaar", !kanHoren(item.w));
    oor.classList.toggle("wenk", !st.gehoord);
    goed.classList.toggle("onzichtbaar", !st.gehoord);
    // Een woord dat al terugkwam, mag na het luisteren gewoon door.
    opnieuw.classList.toggle("onzichtbaar", !st.gehoord || item.terug);
  }

  function schrijfMeting(item, uitkomst) {
    const log = opslag.lees("balimba.metingen", []);
    log.push({
      w: item.w,
      level: woorden.levels[plek.level].nummer,
      ronde: plek.ronde + 1,
      vorm: "alleen",
      ms: Math.round(performance.now() - st.t0),
      terug: item.terug,
      uitkomst,
      t: Date.now()
    });
    opslag.schrijf("balimba.metingen", log);
  }

  function geefSter() {
    const slot = $("sterren").children[st.sterren];
    st.sterren++;
    belletje();
    dieren("blij");
    if (!slot) return;

    const weg = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (weg) { slot.classList.add("vol"); return; }

    const van = $("woord").getBoundingClientRect();
    const naar = slot.getBoundingClientRect();
    const s = document.createElement("div");
    s.className = "vlieg";
    s.textContent = "★";
    document.body.appendChild(s);
    const b = s.getBoundingClientRect();
    const x0 = van.left + van.width / 2 - b.width / 2, y0 = van.top + van.height / 2 - b.height / 2;
    const x1 = naar.left + naar.width / 2 - b.width / 2, y1 = naar.top + naar.height / 2 - b.height / 2;
    s.style.transform = "translate(" + x0 + "px," + y0 + "px) scale(1)";
    void s.offsetWidth;
    s.style.transform = "translate(" + x1 + "px," + y1 + "px) scale(.4)";
    let klaar = false;
    const land = () => { if (klaar) return; klaar = true; s.remove(); slot.classList.add("vol"); };
    s.addEventListener("transitionend", land, { once: true });
    setTimeout(land, 700);
  }

  // Een woord dat terugkwam en nu goed ging: geen nieuwe ster, wel een beetje feest.
  function vonken() {
    belletje();
    dieren("blij");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = $("woord").getBoundingClientRect();
    for (let i = 0; i < 6; i++) {
      const v = document.createElement("div");
      v.className = "vonk";
      v.textContent = "✨";
      const hoek = (Math.PI * 2 * i) / 6;
      v.style.left = r.left + r.width / 2 - 18 + "px";
      v.style.top = r.top + r.height / 2 - 18 + "px";
      v.style.setProperty("--dx", Math.cos(hoek) * 150 + "px");
      v.style.setProperty("--dy", Math.sin(hoek) * 110 + "px");
      document.body.appendChild(v);
      setTimeout(() => v.remove(), 750);
    }
  }

  function volgende(wacht) {
    const ronde = st;
    st.bezig = true;
    setTimeout(() => {
      if (st !== ronde) return;      // ze is intussen naar het begin gegaan
      st.i++;
      if (st.i >= st.rij.length) rondeKlaar(); else toonWoord();
    }, wacht);
  }

  function opGoed() {
    if (!st || st.bezig || !st.gehoord) return;
    const item = nu();
    schrijfMeting(item, "goed");
    $("woord").classList.add("raak");
    if (!item.sterGehad) { item.sterGehad = true; geefSter(); } else { vonken(); }
    volgende(650);
  }

  // Ze had het niet goed: een aanmoediging, en het woord komt aan het eind van de ronde terug.
  function opOpnieuw() {
    if (!st || st.bezig || !st.gehoord) return;
    const item = nu(), ronde = st;
    st.bezig = true;
    speelAf($("woord"), "wiebel");
    dieren("moedig");
    schrijfMeting(item, "nog een keer");
    st.rij.push({ w: item.w, terug: true, sterGehad: false });
    zegZin("nogEens").then((duur) => { if (st === ronde) volgende(Math.max(1100, (duur || 0) * 1000 + 250)); });
  }

  function opOor() {
    if (!st || st.bezig) return;
    zegWoord(nu().w);
    st.gehoord = true;
    zetKnoppen();
  }

  function rondeKlaar() {
    maakSterren($("eindsterren"), st.totaal, st.sterren);
    toonScherm("klaar");
    fanfare();

    // Deze ronde telt mee voor de lopende doorgang van het level.
    const l = plek.level, n = aantalRondes(l);
    const d = haal("doorgang");
    const gedaan = new Set(d[l] || []);
    gedaan.add(plek.ronde);
    let verdiend = false;
    if (gedaan.size >= n) {
      // Alle rondes gespeeld: het level is één keer rond. Dat levert een sticker op, tot de rij vol is.
      d[l] = [];
      if (geplakt(l).length + tegoed(l) < stickers.perLevel) {
        const t = haal("tegoed"); t[l] = (t[l] || 0) + 1; zet("tegoed", t);
        verdiend = true;
      }
    } else {
      d[l] = [...gedaan];
    }
    zet("doorgang", d);

    // Volgende ronde klaarzetten: de eerstvolgende die in deze doorgang nog niet gespeeld is.
    for (let k = 1; k <= n; k++) {
      const r = (plek.ronde + k) % n;
      if (!d[l].includes(r)) { plek.ronde = r; break; }
    }
    bewaarPlek();
    $("verder").classList.toggle("verborgen", verdiend);
    $("naarSticker").classList.toggle("verborgen", !verdiend);
    // Heel level rond: De Grote Aap danst. Anders dansen de eenhoorn en het katje.
    $("gorilla").classList.toggle("verborgen", !verdiend);
    $("klaarDuo").classList.toggle("verborgen", verdiend);
    const trots = verdiend && (inst.zinnen.levelKlaar || []).some((x) => opnames.zinnen.includes(x.id));
    if (verdiend) setTimeout(fanfare, 700);
    setTimeout(() => zegZin(trots ? "levelKlaar" : "rondeKlaar"), verdiend ? 1500 : 900);
  }

  // ---------- De tocht: het stickerbord als een pad ----------
  // Elk level is vijf stappen: vier stapstenen en dan een plek (kasteel, eiland, regenboog...).
  // Op elke stap plakt ze een sticker. Het katje staat bij de sticker die het laatst is geplakt.

  const SVG = "http://www.w3.org/2000/svg";
  const svgEl = (naam, attrs) => {
    const e = document.createElementNS(SVG, naam);
    for (const k of Object.keys(attrs || {})) e.setAttribute(k, attrs[k]);
    return e;
  };
  const allesAf = () => woorden.levels.every((_, i) => geplakt(i).length >= stickers.perLevel);

  // Waar staat het katje? Bij de laatst geplakte sticker, anders bij het huisje.
  function katPlek() {
    const k = opslag.lees("balimba.kat", null);
    if (k && geplakt(k.level).length > k.i) return tocht.levels[k.level].stappen[k.i];
    for (let l = woorden.levels.length - 1; l >= 0; l--) {
      const n = Math.min(geplakt(l).length, stickers.perLevel);
      if (n > 0) return tocht.levels[l].stappen[n - 1];
    }
    return tocht.start;
  }

  // Tekent de tocht in een vak. Geeft de stenen terug, per level een rij.
  function tekenTocht(vak, doelLevel) {
    const B = tocht.breedte, H = tocht.hoogte;
    const pct = (p) => ({ left: (p[0] / B) * 100 + "%", top: (p[1] / H) * 100 + "%" });
    vak.innerHTML = "";

    const kaart = svgEl("svg", { class: "kaart", viewBox: "0 0 " + B + " " + H });
    // Het pad: een vloeiende lijn langs alle stappen.
    const punten = [tocht.start].concat(...tocht.levels.map((l) => l.stappen));
    let d = "M" + punten[0][0] + " " + punten[0][1];
    for (let i = 1; i < punten.length - 1; i++) {
      const m = [(punten[i][0] + punten[i + 1][0]) / 2, (punten[i][1] + punten[i + 1][1]) / 2];
      d += " Q" + punten[i][0] + " " + punten[i][1] + " " + m[0] + " " + m[1];
    }
    d += " L" + punten[punten.length - 1][0] + " " + punten[punten.length - 1][1];
    kaart.appendChild(svgEl("path", { d, fill: "none", stroke: "#fff3cf", "stroke-width": 26, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: ".95" }));
    kaart.appendChild(svgEl("path", { d, fill: "none", stroke: "#f0d9a0", "stroke-width": 4, "stroke-linecap": "round", "stroke-dasharray": "2 16" }));

    const zet = (id, x, y, w, klas) => {
      const u = svgEl("use", { href: "#" + id, x: x - w / 2, y: y - w * (120 / 140) + 14, width: w, height: w * (120 / 140) });
      if (klas) u.setAttribute("class", klas);
      kaart.appendChild(u);
      return u;
    };
    zet("t-huis", tocht.start[0], tocht.start[1] + 22, 120);
    const plekken = tocht.levels.map((lvl, i) => {
      const eind = lvl.stappen[lvl.stappen.length - 1];
      const af = geplakt(i).length >= stickers.perLevel;
      const u = zet("p-" + lvl.plek, eind[0], eind[1] - 32, lvl.groot ? 180 : 132, "plek" + (af ? " af" : ""));
      const nr = svgEl("g", {});
      const bx = eind[0] - (lvl.groot ? 86 : 64), by = eind[1] + 6;
      nr.appendChild(svgEl("circle", { cx: bx, cy: by, r: 17, fill: "#8a4fff", stroke: "#fff", "stroke-width": 3 }));
      const t = svgEl("text", { x: bx, y: by + 7, "text-anchor": "middle", "font-size": 20, "font-weight": 700, fill: "#fff", "font-family": "Andika, sans-serif" });
      t.textContent = String(woorden.levels[i].nummer);
      nr.appendChild(t);
      kaart.appendChild(nr);
      return u;
    });
    vak.appendChild(kaart);

    let doel = null;
    const stenen = tocht.levels.map((lvl, l) => lvl.stappen.map((p, i) => {
      const v = document.createElement("span");
      v.className = "vakje steen";
      Object.assign(v.style, pct(p));
      const id = geplakt(l)[i];
      if (id) {
        v.classList.add("vol");
        const img = document.createElement("img");
        img.className = "sticker"; img.alt = ""; img.draggable = false;
        img.src = "img/stickers/" + id + ".svg";
        v.appendChild(img);
      } else if (l === doelLevel && !doel) { v.classList.add("doel"); doel = v; }
      vak.appendChild(v);
      return v;
    }));

    const loper = svgEl("svg", { class: "loper", viewBox: "0 0 160 150" });
    loper.appendChild(svgEl("use", { href: "#t-kat" }));
    Object.assign(loper.style, pct(katPlek()));
    vak.appendChild(loper);

    return { stenen, doel, plekken, loper, pct };
  }

  // ---------- Sticker kiezen en plakken ----------

  function toonKiezen(level) {
    stil();
    st = null;
    toonScherm("kiezen");
    const { doel } = tekenTocht($("kiesTocht"), level);

    // Een vel met stickers: eerst de stickers die nog nergens geplakt zijn.
    const gebruikt = new Set(Object.values(haal("stickers")).flat());
    const alle = schud(stickers.stickers.map((x) => x.id));
    const keuze = alle.filter((id) => !gebruikt.has(id)).concat(alle.filter((id) => gebruikt.has(id))).slice(0, stickers.keuzePerVel);
    const vel = $("vel");
    vel.innerHTML = "";
    for (const id of schud(keuze)) {
      const img = document.createElement("img");
      img.className = "sticker"; img.alt = ""; img.draggable = false;
      img.src = "img/stickers/" + id + ".svg";
      maakSleepbaar(img, id, level, doel);
      vel.appendChild(img);
    }
  }

  function maakSleepbaar(img, id, level, doel) {
    img.addEventListener("pointerdown", (e) => {
      if (!doel || doel.classList.contains("vol")) return;
      e.preventDefault();
      geluidAan();
      const r = img.getBoundingClientRect();
      const zweef = img.cloneNode();
      zweef.className = "sticker zweef";
      zweef.style.width = r.width + "px";
      zweef.style.left = r.left + "px";
      zweef.style.top = r.top + "px";
      document.body.appendChild(zweef);
      img.style.visibility = "hidden";
      const dx = e.clientX - r.left, dy = e.clientY - r.top;

      // Ruim genomen: de sticker hoeft de steen alleen maar te raken.
      const raakt = () => {
        const z = zweef.getBoundingClientRect(), v = doel.getBoundingClientRect();
        return Math.hypot(z.left + z.width / 2 - (v.left + v.width / 2), z.top + z.height / 2 - (v.top + v.height / 2)) < Math.max(v.width, 44) * 1.1;
      };
      const beweeg = (ev) => {
        zweef.style.left = ev.clientX - dx + "px";
        zweef.style.top = ev.clientY - dy + "px";
        doel.classList.toggle("boven", raakt());
      };
      const los = () => {
        window.removeEventListener("pointermove", beweeg);
        window.removeEventListener("pointerup", los);
        window.removeEventListener("pointercancel", los);
        doel.classList.remove("boven");
        if (raakt()) { plak(zweef, id, level, doel); return; }
        zweef.remove();
        img.style.visibility = "";
      };
      window.addEventListener("pointermove", beweeg);
      window.addEventListener("pointerup", los);
      window.addEventListener("pointercancel", los);
    });
  }

  function plak(zweef, id, level, doel) {
    const van = katPlek();                       // waar het katje nu staat
    const s = haal("stickers"); s[level] = (s[level] || []).concat(id); zet("stickers", s);
    const t = haal("tegoed"); t[level] = Math.max(0, (t[level] || 0) - 1); zet("tegoed", t);
    const i = s[level].length - 1;
    opslag.schrijf("balimba.kat", { level, i });

    const v = doel.getBoundingClientRect();
    zweef.classList.add("landt");
    zweef.style.width = v.width * 0.92 + "px";
    zweef.style.left = v.left + v.width * 0.04 + "px";
    zweef.style.top = v.top + v.height * 0.04 + "px";
    doel.classList.remove("doel");
    belletje();
    setTimeout(() => { zweef.remove(); toonBord({ van, level, i }); }, 320);
  }

  // Het bord op volle grootte. Met 'nieuw' loopt het katje naar de sticker die net is geplakt.
  function toonBord(nieuw) {
    toonScherm("stickerbord");
    const { stenen, plekken, loper, pct } = tekenTocht($("tocht"), -1);

    // Voor de ouder: een sticker lang ingedrukt houden haalt hem weer weg.
    stenen.forEach((rij, l) => rij.forEach((v, i) => {
      if (!v.classList.contains("vol")) return;
      let timer = null;
      const stop = () => clearTimeout(timer);
      v.addEventListener("pointerdown", () => {
        timer = setTimeout(() => {
          if (!window.confirm("Deze sticker weghalen?")) return;
          const s = haal("stickers"); s[l].splice(i, 1); zet("stickers", s);
          toonBord();
        }, 1500);
      });
      for (const soort of ["pointerup", "pointerleave", "pointercancel"]) v.addEventListener(soort, stop);
    }));

    if (!nieuw) return;
    const levelAf = geplakt(nieuw.level).length >= stickers.perLevel;
    stenen[nieuw.level][nieuw.i].classList.add("net");
    if (levelAf) plekken[nieuw.level].classList.remove("af");     // kleurt zo meteen in
    Object.assign(loper.style, pct(nieuw.van));
    void loper.getBoundingClientRect();
    setTimeout(() => {
      loper.classList.add("loopt");
      Object.assign(loper.style, pct(tocht.levels[nieuw.level].stappen[nieuw.i]));
    }, 350);
    setTimeout(() => {
      if (levelAf) { plekken[nieuw.level].classList.add("af", "net"); fanfare(); } else { belletje(); }
    }, 1500);
    if (allesAf()) setTimeout(toonFinale, 4200);
  }

  // ---------- Finale: alle dertig stickers zijn geplakt ----------

  function toonFinale() {
    toonScherm("finale");
    const feest = $("feest");
    feest.innerHTML = "";
    const dier = (id) => { const d = svgEl("svg", { class: "dier", viewBox: "0 0 160 150" }); d.appendChild(svgEl("use", { href: "#" + id })); return d; };
    const aap = $("gorilla").cloneNode(true);
    aap.removeAttribute("id"); aap.classList.remove("verborgen");
    feest.append(dier("t-eenhoorn"), aap, dier("t-kat"));

    const conf = $("confetti");
    conf.innerHTML = "";
    const kleuren = ["#ff8fb0", "#ffbe7a", "#ffe680", "#9be0a4", "#8fc7ff", "#c3a6ff", "#ffd24a"];
    for (let i = 0; i < 60; i++) {
      const c = document.createElement("i");
      c.style.left = Math.random() * 100 + "%";
      c.style.background = kleuren[i % kleuren.length];
      c.style.animationDuration = 2.5 + Math.random() * 3 + "s";
      c.style.animationDelay = -Math.random() * 5 + "s";
      conf.appendChild(c);
    }
    fanfare();
    setTimeout(fanfare, 900);
    const soort = (inst.zinnen.alleKlaar || []).some((x) => opnames.zinnen.includes(x.id)) ? "alleKlaar" : "levelKlaar";
    setTimeout(() => zegZin(soort), 1900);
  }

  function naarStart() {
    stil();
    st = null;
    vulStart();
    toonScherm("start");
  }

  // ---------- Opstarten ----------

  // De databestanden krijgen het versienummer van de pagina mee, zodat ze bij elke
  // nieuwe versie opnieuw worden opgehaald in plaats van uit de cache van de browser.
  function haalJson(pad) {
    return fetch(pad + "?v=" + (window.BALIMBA_VERSIE || ""), { cache: "no-cache" })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  }

  async function laad() {
    try {
      const [w, i] = await Promise.all([
        haalJson("data/woorden.json"),
        haalJson("data/instellingen.json")
      ]);
      woorden = w; inst = i;
      // Ontbreekt de lijst met opnames, dan speelt het spel zonder stem.
      opnames = await haalJson("data/opnames.json").catch(() => opnames);
      stickers = await haalJson("data/stickers.json").catch(() => stickers);
      tocht = await haalJson("data/tocht.json");
      if (!woorden.levels[plek.level] || plek.ronde >= aantalRondes(plek.level)) plek = { level: 0, ronde: 0 };
      neemOudeRondesMee();
      vulStart();
      // Voorbeeld voor de ouder: index.html?toon=aap laat de dansende aap zien, zonder iets te bewaren.
      const toon = new URLSearchParams(location.search).get("toon");
      if (toon === "finale") toonFinale();
      if (toon === "aap") {
        maakSterren($("eindsterren"), inst.rondeGrootte, inst.rondeGrootte);
        $("gorilla").classList.remove("verborgen");
        $("klaarDuo").classList.add("verborgen");
        $("verder").classList.add("verborgen");
        $("naarSticker").classList.add("verborgen");
        toonScherm("klaar");
      }
    } catch (e) {
      $("laadfout").classList.remove("verborgen");
      $("speel").disabled = true;
    }
  }

  $("speel").addEventListener("click", startRonde);
  $("goed").addEventListener("click", opGoed);
  $("opnieuw").addEventListener("click", opOpnieuw);
  $("oor").addEventListener("click", opOor);
  $("naarHuis").addEventListener("click", naarStart);
  $("klaarHuis").addEventListener("click", naarStart);
  $("bordHuis").addEventListener("click", naarStart);
  $("finaleHuis").addEventListener("click", naarStart);
  $("verder").addEventListener("click", startRonde);
  $("naarSticker").addEventListener("click", () => toonKiezen(plek.level));
  // Het stickerbord. Ligt er nog een verdiende sticker klaar, dan eerst die plakken.
  $("naarBord").addEventListener("click", () => {
    const l = levelMetTegoed();
    if (l >= 0) toonKiezen(l); else toonBord();
  });

  laad();
})();
