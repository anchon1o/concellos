// Rankings de Concellos de Galicia, gardados en Supabase "xogos":
//   con_ranking_reto   -> Reto (unha táboa lóxica por nivel e zona)
//   con_ranking_diario -> Reto diario (unha por día, en hora de España)
// A páxina segue chamando a /api/ranking igual que antes; só cambia onde se garda.
const NIVEIS = ["facil", "medio", "dificil", "perfecto"];
const TOTAL = { todo: 313, "15": 93, "27": 67, "32": 92, "36": 61 };
const AMOSAR = 20;      // marcas que se devolven
const DIAS_DIARIO = 45; // días que se conservan do reto diario

const SB_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";

// Cabeceiras para a API REST de Supabase (vale coa clave service_role antiga ou coa nova sb_secret_)
function cabeceiras(extra) {
  const h = { apikey: SB_KEY, "Content-Type": "application/json", ...extra };
  if (!SB_KEY.startsWith("sb_")) h.Authorization = `Bearer ${SB_KEY}`;
  return h;
}
async function sb(path, opcions = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...opcions, headers: cabeceiras(opcions.headers) });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r;
}
// Cantas filas cumpren un filtro (para calcular o posto)
async function contar(path) {
  const r = await sb(path, { method: "HEAD", headers: { Prefer: "count=exact" } });
  const rango = r.headers.get("content-range") || "*/0";
  return Number(rango.split("/")[1]) || 0;
}

// Data en Galicia (hora de Madrid); acéptase tamén a de onte polas partidas que rematan pasada a medianoite
const dataMadrid = t => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(t);
const datasValidas = () => [dataMadrid(new Date()), dataMadrid(new Date(Date.now() - 864e5))];
const limpaAlias = a => String(a || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 20);

// O xogo espera estes nomes de campos (tempo en ms, data AAAA-MM-DD)
const deReto = f => ({ id: f.id, alias: f.alias, acertos: f.acertos, total: f.total, erros: f.erros, tempo: f.tempo_ms, data: String(f.creado).slice(0, 10) });
const deDiario = f => ({ id: f.id, alias: f.alias, puntos: f.puntos, acertos: f.acertos, erros: f.erros, tempo: f.tempo_ms, data: f.data });

const ORDE_RETO = "acertos.desc,erros.asc,tempo_ms.asc";
const ORDE_DIARIO = "puntos.desc,erros.asc,tempo_ms.asc";
const enc = encodeURIComponent;

async function topReto(nivel, zona, n = AMOSAR) {
  const r = await sb(`con_ranking_reto?select=id,alias,acertos,total,erros,tempo_ms,creado&nivel=eq.${nivel}&zona=eq.${zona}&order=${ORDE_RETO}&limit=${n}`);
  return (await r.json()).map(deReto);
}
async function topDiario(data, n = AMOSAR, desde = null) {
  const filtro = desde ? `data=gte.${desde}&data=lte.${data}` : `data=eq.${data}`;
  const r = await sb(`con_ranking_diario?select=id,alias,puntos,acertos,erros,tempo_ms,data&${filtro}&order=${ORDE_DIARIO}&limit=${n}`);
  return (await r.json()).map(deDiario);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!SB_URL || !SB_KEY) return res.status(500).json({ erro: "Falta conectar Supabase (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY)." });

  try {
    // ---------- Ler ----------
    if (req.method === "GET") {
      // n: posicións (1-50); cache=1: a páxina ranking.html acepta datos de ata 20 s para ir máis rápida
      const n = Math.min(50, Math.max(1, Math.floor(Number(req.query.n)) || AMOSAR));
      if (req.query.cache === "1") res.setHeader("Cache-Control", "public, s-maxage=20, stale-while-revalidate=60");
      const DATA = /^\d{4}-\d{2}-\d{2}$/;
      if (req.query.tipo === "diario") {
        const data = String(req.query.data || dataMadrid(new Date()));
        const desde = req.query.desde ? String(req.query.desde) : null;
        if (!DATA.test(data) || (desde && !DATA.test(desde))) return res.status(400).json({ erro: "Data non válida." });
        return res.status(200).json({ top: await topDiario(data, n, desde) });
      }
      const { nivel, zona } = req.query;
      if (!NIVEIS.includes(nivel) || !(zona in TOTAL)) return res.status(400).json({ erro: "Parámetros non válidos." });
      return res.status(200).json({ top: await topReto(nivel, zona, n) });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ erro: "Método non permitido." });
    }

    // ---------- Gardar ----------
    let b = req.body;
    if (typeof b === "string") b = JSON.parse(b || "{}");
    b = b || {};
    const alias = limpaAlias(b.alias);
    if (!alias) return res.status(400).json({ erro: "Falta o alias." });

    if (b.tipo === "diario") {
      const data = String(b.data || "");
      const puntos = Math.floor(Number(b.puntos)), acertos = Math.floor(Number(b.acertos));
      const erros = Math.floor(Number(b.erros)), tempo = Math.floor(Number(b.tempo));
      if (!datasValidas().includes(data)) return res.status(400).json({ erro: "Ese reto xa pechou." });
      if (!(acertos >= 1 && acertos <= 10) || !(puntos >= acertos && puntos <= acertos * 3) ||
          !(erros >= 0 && erros <= 1000) || !(tempo >= acertos * 400 && tempo <= 72e5))
        return res.status(400).json({ erro: "Marca non válida." });

      const r = await sb("con_ranking_diario?select=id", {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ data, alias, puntos, acertos, erros, tempo_ms: tempo }),
      });
      const [{ id }] = await r.json();
      const mellores = await contar(`con_ranking_diario?data=eq.${data}&or=${enc(`(puntos.gt.${puntos},and(puntos.eq.${puntos},erros.lt.${erros}),and(puntos.eq.${puntos},erros.eq.${erros},tempo_ms.lt.${tempo}))`)}`);
      // limpeza: bórranse os días antigos
      const vello = dataMadrid(new Date(Date.now() - DIAS_DIARIO * 864e5));
      sb(`con_ranking_diario?data=lt.${vello}`, { method: "DELETE" }).catch(() => {});
      return res.status(200).json({ id, posicion: mellores + 1, top: await topDiario(data) });
    }

    const nivel = b.nivel, zona = b.zona;
    const acertos = Math.floor(Number(b.acertos)), erros = Math.floor(Number(b.erros)), tempo = Math.floor(Number(b.tempo));
    if (!NIVEIS.includes(nivel) || !(zona in TOTAL)) return res.status(400).json({ erro: "Nivel ou zona non válidos." });
    const total = TOTAL[zona];
    if (!(acertos >= 1 && acertos <= total) || !(erros >= 0 && erros <= 100000) || !(tempo >= 1000 && tempo <= 36e6))
      return res.status(400).json({ erro: "Marca non válida." });
    if (tempo < acertos * 400) return res.status(400).json({ erro: "Marca non válida." }); // ninguén acerta tan rápido

    const r = await sb("con_ranking_reto?select=id", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ alias, nivel, zona, acertos, total, erros, tempo_ms: tempo }),
    });
    const [{ id }] = await r.json();
    const mellores = await contar(`con_ranking_reto?nivel=eq.${nivel}&zona=eq.${zona}&or=${enc(`(acertos.gt.${acertos},and(acertos.eq.${acertos},erros.lt.${erros}),and(acertos.eq.${acertos},erros.eq.${erros},tempo_ms.lt.${tempo}))`)}`);
    return res.status(200).json({ id, posicion: mellores + 1, top: await topReto(nivel, zona) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: "Erro do servidor." });
  }
};
