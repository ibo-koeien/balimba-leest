// Balimba leest – stap 2: één speelbare ronde in twee speelvormen.
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
  let plek = opslag.lees("balimba.plek", { level: 0, ronde: 0 });
  let st = null;            // toestand van de lopende ronde

  // ---------- Geluid ----------

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

  function zeg(tekst, tempo) {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(tekst);
    u.lang = inst.stem.taal;
    if (stem) u.voice = stem;
    u.rate = tempo;
    speechSynthesis.speak(u);
  }

  // Eén plek waar een woord wordt voorgezegd. Hier komen in stap 6 de eigen opnames.
  function zegWoord(w) { zeg(w, inst.stem.tempoWoord); }
  function zegZin(z) { zeg(z, inst.stem.tempoZin); }

  let audio = null;
  function toon(reeks) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
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
    for (const s of ["start", "spel", "klaar"]) $(s).classList.toggle("verborgen", s !== naam);
  }

  function speelAf(el, klas) {
    el.classList.remove(klas);
    void el.offsetWidth;            // animatie opnieuw laten starten
    el.classList.add(klas);
  }

  function aantalRondes(level) {
    return Math.ceil(woorden.levels[level].woorden.length / inst.rondeGrootte);
  }

  function vulStart() {
    const lvl = woorden.levels[plek.level];
    $("waar").textContent = "Level " + lvl.nummer + " · ronde " + (plek.ronde + 1) + " van " + aantalRondes(plek.level);
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

  function startRonde(vorm) {
    const n = inst.rondeGrootte;
    const lijst = woorden.levels[plek.level].woorden.slice(plek.ronde * n, (plek.ronde + 1) * n);
    st = {
      vorm,
      rij: schud(lijst).map((w) => ({ w, terug: false, sterGehad: false })),
      i: 0,
      sterren: 0,
      totaal: lijst.length,
      bezig: false
    };
    document.body.dataset.vorm = vorm;
    maakSterren($("sterren"), st.totaal, 0);
    toonScherm("spel");
    toonWoord();
  }

  const nu = () => st.rij[st.i];

  function toonWoord() {
    const item = nu();
    st.pogingen = 0;
    st.geholpen = false;
    st.gehoord = false;
    st.bezig = false;
    st.t0 = performance.now();

    const el = $("woord");
    el.textContent = item.w;
    el.className = "woord " + (item.w.length > 6 ? "lang" : "kort") + (item.terug ? " terug" : "");
    speelAf(el, "komt");
    zetKnoppen();
  }

  function zetKnoppen() {
    const item = nu();
    const goed = $("goed"), opnieuw = $("opnieuw"), oor = $("oor");
    if (st.vorm === "samen") {
      // De ouder beoordeelt. Het oortje is hulp voor Celeste.
      goed.classList.remove("onzichtbaar");
      opnieuw.classList.remove("onzichtbaar");
      oor.classList.add("bijzaak");
      oor.classList.remove("wenk");
    } else {
      // Celeste leest, luistert en beoordeelt daarna zelf.
      oor.classList.remove("bijzaak");
      oor.classList.toggle("wenk", !st.gehoord);
      goed.classList.toggle("onzichtbaar", !st.gehoord);
      // Een woord dat al terugkwam, mag na het luisteren gewoon door.
      opnieuw.classList.toggle("onzichtbaar", !st.gehoord || item.terug);
    }
  }

  function schrijfMeting(item, uitkomst) {
    const log = opslag.lees("balimba.metingen", []);
    log.push({
      w: item.w,
      level: woorden.levels[plek.level].nummer,
      ronde: plek.ronde + 1,
      vorm: st.vorm,
      ms: Math.round(performance.now() - st.t0),
      pogingen: st.pogingen + 1,
      geholpen: st.geholpen,
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
    speelAf($("eenhoorn"), "blij");
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
    speelAf($("eenhoorn"), "blij");
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
    st.bezig = true;
    setTimeout(() => {
      st.i++;
      if (st.i >= st.rij.length) rondeKlaar(); else toonWoord();
    }, wacht);
  }

  function opGoed() {
    if (!st || st.bezig) return;
    if (st.vorm === "alleen" && !st.gehoord) return;
    const item = nu();
    schrijfMeting(item, "goed");
    $("woord").classList.add("raak");
    if (!item.sterGehad) { item.sterGehad = true; geefSter(); } else { vonken(); }
    // Samen: een woord waar hulp bij nodig was, komt aan het eind nog één keer terug.
    if (st.vorm === "samen" && st.geholpen && !item.terug) {
      st.rij.push({ w: item.w, terug: true, sterGehad: true });
    }
    volgende(650);
  }

  function opOpnieuw() {
    if (!st || st.bezig) return;
    const item = nu();
    speelAf($("woord"), "wiebel");
    speelAf($("eenhoorn"), "moedig");

    if (st.vorm === "samen") {
      st.pogingen++;
      if (st.pogingen === 1) {
        zegZin(kies(inst.zinnen.nogEens));          // tweede poging
      } else {
        st.geholpen = true;                          // voorzeggen, zij zegt het na
        zegWoord(item.w);
      }
      return;
    }

    // Alleen: ze had het niet goed. Het woord klinkt nog eens en komt aan het eind terug.
    if (!st.gehoord) return;
    schrijfMeting(item, "nog een keer");
    zegWoord(item.w);
    st.rij.push({ w: item.w, terug: true, sterGehad: false });
    volgende(1900);
  }

  function opOor() {
    if (!st || st.bezig) return;
    zegWoord(nu().w);
    if (st.vorm === "samen") st.geholpen = true;
    st.gehoord = true;
    zetKnoppen();
  }

  function rondeKlaar() {
    maakSterren($("eindsterren"), st.totaal, st.sterren);
    toonScherm("klaar");
    fanfare();
    setTimeout(() => zegZin(kies(inst.zinnen.rondeKlaar)), 900);

    // Volgende ronde klaarzetten; na de laatste ronde van een level door naar het volgende level.
    plek.ronde++;
    if (plek.ronde >= aantalRondes(plek.level)) {
      plek.ronde = 0;
      plek.level = (plek.level + 1) % woorden.levels.length;
    }
    opslag.schrijf("balimba.plek", plek);
  }

  function naarStart() {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    st = null;
    vulStart();
    toonScherm("start");
  }

  // ---------- Opstarten ----------

  async function laad() {
    try {
      const [w, i] = await Promise.all([
        fetch("data/woorden.json").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
        fetch("data/instellingen.json").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      ]);
      woorden = w; inst = i;
      if (!woorden.levels[plek.level] || plek.ronde >= aantalRondes(plek.level)) plek = { level: 0, ronde: 0 };
      vulStart();
    } catch (e) {
      $("laadfout").classList.remove("verborgen");
      $("kiesSamen").disabled = true;
      $("kiesAlleen").disabled = true;
    }
  }

  let laatsteVorm = "samen";
  $("kiesSamen").addEventListener("click", () => { laatsteVorm = "samen"; startRonde("samen"); });
  $("kiesAlleen").addEventListener("click", () => { laatsteVorm = "alleen"; startRonde("alleen"); });
  $("goed").addEventListener("click", opGoed);
  $("opnieuw").addEventListener("click", opOpnieuw);
  $("oor").addEventListener("click", opOor);
  $("naarHuis").addEventListener("click", naarStart);
  $("klaarHuis").addEventListener("click", naarStart);
  $("verder").addEventListener("click", () => startRonde(laatsteVorm));

  laad();
})();
