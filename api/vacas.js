// "Onde teño as vacas?": partidas gardadas en Redis.
//  - 2 xogadores: quendas alternas, cada un ataca as vacas do outro.
//  - 3 ou 4 xogadores: roldas simultáneas nun mapa común, con reloxo por rolda; puntos por vaca allea atopada.
// Resultado dunha tirada: vaca (había unha), pasto (vaca allea a `dist` concellos ou menos), terra (nada preto).
const crypto = require("crypto");

const REDIS_URL = process.env.REDIS_URL;
const URL_REST = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN_REST = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const CADUCA = 60 * 60 * 12;
const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const RAZAS = ["rubia", "cachena", "frisona", "milka"];
const TEMPO_ROLDA = 40; // segundos por rolda (3-4 xogadores)
const MAX_ROLDAS = 40;
const VACAS_POR_XOGADORES = { 2: 6, 3: 5, 4: 4 };

let cliente = null;
function conectar() {
  if (!cliente) {
    const { createClient } = require("redis");
    const c = createClient({ url: REDIS_URL });
    c.on("error", () => {});
    cliente = c.connect().then(() => c).catch(e => { cliente = null; throw e; });
  }
  return cliente;
}
async function redis(comandos) {
  if (REDIS_URL) {
    const c = await conectar();
    const out = [];
    for (const cmd of comandos) out.push(await c.sendCommand(cmd.map(String)));
    return out;
  }
  const r = await fetch(`${URL_REST}/pipeline`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN_REST}`, "Content-Type": "application/json" },
    body: JSON.stringify(comandos),
  });
  if (!r.ok) throw new Error("Redis " + r.status);
  return (await r.json()).map(x => { if (x.error) throw new Error(x.error); return x.result; });
}

const chave = sala => `concellos:vacas:${sala}`;
async function ler(sala) { const [j] = await redis([["GET", chave(sala)]]); return j ? JSON.parse(j) : null; }
async function gardar(p) { p.v = (p.v || 0) + 1; await redis([["SET", chave(p.sala), JSON.stringify(p), "EX", String(CADUCA)]]); }
const codigo = () => Array.from({ length: 4 }, () => LETRAS[crypto.randomInt(LETRAS.length)]).join("");
const limpaNome = n => String(n || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 20) || "Anónimo";
const novoXogador = (token, nome) => ({ token, nome: limpaNome(nome), vacas: [], listo: false, tiros: [], raza: null, fora: false });

function distancia(veci, id, vacas, max) {
  const obx = new Set(vacas);
  if (obx.has(id)) return 0;
  let fronte = [id], vistos = new Set(fronte);
  for (let d = 1; d <= max; d++) {
    const nova = [];
    for (const c of fronte) for (const n of (veci[c] || [])) {
      if (vistos.has(n)) continue;
      if (obx.has(n)) return d;
      vistos.add(n); nova.push(n);
    }
    fronte = nova;
  }
  return Infinity;
}

// ---------- 3-4 xogadores: roldas ----------
const atopadas = p => new Set(p.roldas.flatMap(r => Object.values(r).filter(t => t.r === "vaca").map(t => t.id)));
const vivas = (p, i) => { const a = atopadas(p); return p.xog[i].fora ? [] : p.xog[i].vacas.filter(id => !a.has(id)); };
const puntos = (p, i) => p.roldas.reduce((n, r) => n + (r[i] && r[i].r === "vaca" ? 1 : 0), 0);
const deben = p => p.xog.map((x, i) => i).filter(i => !p.xog[i].fora);

function pecharRolda(p) {
  p.roldas.push(p.actual); p.actual = {};
  const conVacas = p.xog.map((x, i) => vivas(p, i).length > 0);
  const equiposVivos = conVacas.filter(Boolean).length;
  if (equiposVivos <= 1 || p.roldas.length >= MAX_ROLDAS) {
    p.fase = "fin";
    const pts = p.xog.map((x, i) => puntos(p, i)), perd = p.xog.map((x, i) => p.xog[i].vacas.length - vivas(p, i).length);
    let mellor = -1;
    p.xog.forEach((x, i) => { if (x.fora) return; if (mellor < 0 || pts[i] > pts[mellor] || (pts[i] === pts[mellor] && perd[i] < perd[mellor])) mellor = i; });
    p.gañador = mellor;
  } else p.roldaInicio = Date.now();
}
function comprobarRolda(p) {
  if (p.modo !== "roldas" || p.fase !== "xogando") return false;
  const todos = deben(p).every(i => p.actual[i]);
  const caducou = Date.now() - p.roldaInicio > TEMPO_ROLDA * 1000;
  if (todos || caducou) { pecharRolda(p); return true; }
  return false;
}

function vista(p, eu) {
  const min = p.xog[eu];
  if (p.modo === "duelo") {
    const riv = p.xog[1 - eu];
    return {
      modo: "duelo", sala: p.sala, fase: p.fase, v: p.v, eu, quen: p.quen, vacas: p.vacas, dist: p.dist, gañador: p.gañador,
      nomes: p.xog.map(x => x.nome),
      meu: { vacas: min.vacas, listo: !!min.listo, tiros: min.tiros, atopadas: min.tiros.filter(t => t.r === "vaca").length, raza: min.raza },
      rival: riv ? { nome: riv.nome, listo: !!riv.listo, tiros: riv.tiros, atopadas: riv.tiros.filter(t => t.r === "vaca").length, raza: riv.raza, vacas: p.fase === "fin" ? riv.vacas : undefined } : null,
    };
  }
  const a = atopadas(p);
  return {
    modo: "roldas", sala: p.sala, fase: p.fase, v: p.v, eu, vacas: p.vacas, dist: p.dist, gañador: p.gañador, max: p.max, creador: 0,
    tempoRolda: TEMPO_ROLDA, rolda: p.roldas.length + 1, restante: p.fase === "xogando" ? Math.max(0, TEMPO_ROLDA * 1000 - (Date.now() - p.roldaInicio)) : 0,
    xogadores: p.xog.map((x, i) => ({ nome: x.nome, raza: x.raza, listo: !!x.listo, fora: x.fora, puntos: puntos(p, i), quedan: vivas(p, i).length, tirou: !!p.actual[i], vacas: p.fase === "fin" ? x.vacas : undefined })),
    meu: { vacas: min.vacas, listo: !!min.listo, raza: min.raza, tirada: p.actual[eu] ? p.actual[eu].id : null },
    roldas: p.roldas.map(r => Object.entries(r).map(([i, t]) => ({ quen: +i, id: t.id, r: t.r, dono: t.dono }))),
    atopadas: [...a],
  };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!REDIS_URL && !(URL_REST && TOKEN_REST)) return res.status(500).json({ erro: "Falta conectar a base de datos Redis." });
  try {
    if (req.method === "GET") {
      const sala = String(req.query.sala || "").toUpperCase(), token = String(req.query.token || "");
      const p = await ler(sala);
      if (!p) return res.status(404).json({ erro: "Esa sala non existe ou xa caducou." });
      p.modo = p.modo || "duelo"; p.max = p.max || 2; p.roldas = p.roldas || []; p.actual = p.actual || {};
      const eu = p.xog.findIndex(x => x.token === token);
      if (eu < 0) return res.status(403).json({ erro: "Non estás nesta partida." });
      if (comprobarRolda(p)) await gardar(p);
      return res.status(200).json(vista(p, eu));
    }
    if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ erro: "Método non permitido." }); }

    let b = req.body; if (typeof b === "string") b = JSON.parse(b || "{}"); b = b || {};
    const accion = b.accion;

    if (accion === "crear") {
      const veci = b.veci;
      if (!veci || typeof veci !== "object" || Object.keys(veci).length < 100) return res.status(400).json({ erro: "Faltan os datos do mapa." });
      const max = Math.min(4, Math.max(2, Math.floor(Number(b.xogadores)) || 2));
      const modo = max === 2 ? "duelo" : "roldas";
      const vacas = VACAS_POR_XOGADORES[max];
      const dist = Math.min(2, Math.max(1, Math.floor(Number(b.dist)) || 1));
      let sala; for (let i = 0; i < 5; i++) { sala = codigo(); if (!(await ler(sala))) break; }
      const token = crypto.randomUUID();
      const p = { sala, modo, max, fase: "esperando", vacas, dist, veci, quen: 0, gañador: null, creada: Date.now(),
        xog: [novoXogador(token, b.nome)], roldas: [], actual: {}, roldaInicio: 0 };
      await gardar(p);
      return res.status(200).json({ sala, token, eu: 0 });
    }

    const sala = String(b.sala || "").toUpperCase();
    const p = await ler(sala);
    if (!p) return res.status(404).json({ erro: "Esa sala non existe ou xa caducou." });
    p.modo = p.modo || "duelo"; p.max = p.max || 2; p.roldas = p.roldas || []; p.actual = p.actual || {};

    if (accion === "unirse") {
      if (p.fase !== "esperando") return res.status(409).json({ erro: "Esa partida xa comezou." });
      if (p.xog.length >= p.max) return res.status(409).json({ erro: "Esa sala xa está completa." });
      const token = crypto.randomUUID();
      p.xog.push(novoXogador(token, b.nome));
      if (p.xog.length === p.max) { p.fase = "colocando"; p.vacas = VACAS_POR_XOGADORES[p.xog.length]; }
      await gardar(p);
      return res.status(200).json({ sala, token, eu: p.xog.length - 1 });
    }

    const eu = p.xog.findIndex(x => x.token === String(b.token || ""));
    if (eu < 0) return res.status(403).json({ erro: "Non estás nesta partida." });
    const min = p.xog[eu];
    if (comprobarRolda(p)) await gardar(p);

    if (accion === "comezar") {
      if (eu !== 0) return res.status(403).json({ erro: "Só quen creou a sala pode comezar." });
      if (p.fase !== "esperando") return res.status(400).json({ erro: "A partida xa comezou." });
      if (p.xog.length < 3) return res.status(400).json({ erro: "Fan falta polo menos 3 xogadores." });
      p.fase = "colocando"; p.vacas = VACAS_POR_XOGADORES[p.xog.length]; await gardar(p);
      return res.status(200).json(vista(p, eu));
    }

    if (accion === "colocar") {
      if (p.fase !== "colocando") return res.status(400).json({ erro: "Agora non toca colocar vacas." });
      const vacas = [...new Set((b.vacas || []).map(String))].filter(id => p.veci[id]);
      if (vacas.length !== p.vacas) return res.status(400).json({ erro: `Tes que colocar ${p.vacas} vacas.` });
      for (const a of vacas) for (const c of vacas) if (a !== c && (p.veci[a] || []).includes(c))
        return res.status(400).json({ erro: "As vacas non poden estar en concellos veciños." });
      min.vacas = vacas; min.listo = true; min.raza = RAZAS.includes(b.raza) ? b.raza : "rubia";
      if (p.xog.every(x => x.listo)) { p.fase = "xogando"; p.quen = 0; p.roldaInicio = Date.now(); p.actual = {}; }
      await gardar(p);
      return res.status(200).json(vista(p, eu));
    }

    if (accion === "tirar") {
      if (p.fase !== "xogando") return res.status(400).json({ erro: "A partida non está en xogo." });
      const id = String(b.id || "");
      if (!p.veci[id]) return res.status(400).json({ erro: "Concello non válido." });

      if (p.modo === "duelo") {
        const riv = p.xog[1 - eu];
        if (p.quen !== eu) return res.status(400).json({ erro: "Non é a túa quenda." });
        if (min.tiros.some(t => t.id === id)) return res.status(400).json({ erro: "Xa tiraches aí." });
        const d = distancia(p.veci, id, riv.vacas, p.dist);
        const r = d === 0 ? "vaca" : d <= p.dist ? "pasto" : "terra";
        min.tiros.push({ id, r });
        if (min.tiros.filter(t => t.r === "vaca").length >= p.vacas) { p.fase = "fin"; p.gañador = eu; }
        else p.quen = 1 - eu;
        await gardar(p);
        return res.status(200).json({ r, ...vista(p, eu) });
      }

      // roldas: unha tirada por rolda; o resultado revélase cando pecha a rolda
      if (min.fora) return res.status(400).json({ erro: "Deixaches a partida." });
      if (p.actual[eu]) return res.status(400).json({ erro: "Xa tiraches nesta rolda." });
      const xaTirado = p.roldas.some(r => Object.values(r).some(t => t.id === id));
      if (xaTirado) return res.status(400).json({ erro: "Nese concello xa se tirou." });
      const alleas = []; const dono = {};
      p.xog.forEach((x, i) => { if (i !== eu) vivas(p, i).forEach(v => { alleas.push(v); dono[v] = i; }); });
      const d = distancia(p.veci, id, alleas, p.dist);
      const r = d === 0 ? "vaca" : d <= p.dist ? "pasto" : "terra";
      p.actual[eu] = { id, r, dono: r === "vaca" ? dono[id] : undefined };
      comprobarRolda(p);
      await gardar(p);
      return res.status(200).json(vista(p, eu));
    }

    if (accion === "abandonar") {
      if (p.modo === "duelo") {
        if (p.fase !== "fin") { p.fase = "fin"; p.gañador = p.xog[1 - eu] ? 1 - eu : null; await gardar(p); }
      } else {
        min.fora = true;
        if (p.fase === "esperando") p.xog.splice(eu, 1);
        else if (p.fase === "colocando") { min.listo = true; min.vacas = []; if (p.xog.every(x => x.listo)) { p.fase = "xogando"; p.roldaInicio = Date.now(); } }
        else if (p.fase === "xogando") { delete p.actual[eu]; comprobarRolda(p); }
        if (p.xog.filter(x => !x.fora).length < 2 && p.fase !== "fin") { p.fase = "fin"; p.gañador = p.xog.findIndex(x => !x.fora); }
        await gardar(p);
      }
      return res.status(200).json({ fora: true });
    }

    return res.status(400).json({ erro: "Acción descoñecida." });
  } catch (e) {
    return res.status(500).json({ erro: "Erro do servidor." });
  }
};
