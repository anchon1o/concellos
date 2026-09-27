// Ranking do Reto (unha táboa por nivel e zona) e do Reto diario (unha táboa por día).
// Garda as marcas en Redis (conectado desde Vercel > Storage).
const crypto = require("crypto");

const NIVEIS = ["facil", "medio", "dificil", "perfecto"];
const TOTAL = { todo: 313, "15": 93, "27": 67, "32": 92, "36": 61 };
// Vale con Redis Cloud (REDIS_URL) ou con Upstash (variables REST)
const REDIS_URL = process.env.REDIS_URL;
const URL_REST = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN_REST = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const GARDAR = 100; // marcas que se conservan por táboa
const AMOSAR = 20;  // marcas que se devolven

// Conexión reutilizada entre chamadas mentres a función siga quente
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
    const saida = [];
    for (const cmd of comandos) saida.push(await c.sendCommand(cmd.map(String)));
    return saida;
  }
  const r = await fetch(`${URL_REST}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN_REST}`, "Content-Type": "application/json" },
    body: JSON.stringify(comandos),
  });
  if (!r.ok) throw new Error("Redis " + r.status);
  return (await r.json()).map(x => { if (x.error) throw new Error(x.error); return x.result; });
}

const chave = (nivel, zona) => `concellos:ranking:${nivel}:${zona}`;
const chaveDiario = data => `concellos:diario:${data}`;
// Data en Galicia (hora de Madrid); acéptase tamén a de onte polas partidas que rematan pasada a medianoite
const dataMadrid = t => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(t);
const datasValidas = () => [dataMadrid(new Date()), dataMadrid(new Date(Date.now() - 864e5))];
const lerTop = lista => (lista || []).map(m => { try { return JSON.parse(m); } catch { return null; } }).filter(Boolean);

// Máis atopados, logo menos erros, logo menos tempo (en centésimas)
function puntuacion(acertos, erros, tempoMs) {
  const cs = Math.min(Math.round(tempoMs / 10), 99999999);
  return acertos * 1e12 + (9999 - Math.min(erros, 9999)) * 1e8 + (99999999 - cs);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!REDIS_URL && !(URL_REST && TOKEN_REST)) return res.status(500).json({ erro: "Falta conectar a base de datos Redis." });

  try {
    if (req.method === "GET" && req.query.tipo === "diario") {
      const data = String(req.query.data || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ erro: "Data non válida." });
      const [top] = await redis([["ZRANGE", chaveDiario(data), "0", String(AMOSAR - 1), "REV"]]);
      return res.status(200).json({ top: lerTop(top) });
    }

    if (req.method === "GET") {
      const { nivel, zona } = req.query;
      if (!NIVEIS.includes(nivel) || !(zona in TOTAL)) return res.status(400).json({ erro: "Parámetros non válidos." });
      const [top] = await redis([["ZRANGE", chave(nivel, zona), "0", String(AMOSAR - 1), "REV"]]);
      return res.status(200).json({ top: lerTop(top) });
    }

    if (req.method === "POST") {
      let b = req.body;
      if (typeof b === "string") b = JSON.parse(b || "{}");
      b = b || {};
      const alias = String(b.alias || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 20);
      if (!alias) return res.status(400).json({ erro: "Falta o alias." });
      const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "descoñecida";

      // ---- Reto diario: 10 concellos, puntos (3/2/1), erros e tempo ----
      if (b.tipo === "diario") {
        const data = String(b.data || "");
        const puntos = Math.floor(Number(b.puntos)), acertos = Math.floor(Number(b.acertos));
        const erros = Math.floor(Number(b.erros)), tempo = Math.floor(Number(b.tempo));
        if (!datasValidas().includes(data)) return res.status(400).json({ erro: "Ese reto xa pechou." });
        if (!(acertos >= 1 && acertos <= 10) || !(puntos >= acertos && puntos <= acertos * 3) ||
            !(erros >= 0 && erros <= 1000) || !(tempo >= acertos * 400 && tempo <= 72e5))
          return res.status(400).json({ erro: "Marca non válida." });
        const [envios] = await redis([["INCR", `concellos:limite:${ip}`], ["EXPIRE", `concellos:limite:${ip}`, "600"]]);
        if (envios > 20) return res.status(429).json({ erro: "Demasiados envíos. Proba máis tarde." });
        const entrada = { id: crypto.randomUUID(), alias, puntos, acertos, erros, tempo, data };
        const k = chaveDiario(data), m = JSON.stringify(entrada);
        const cs = Math.min(Math.round(tempo / 10), 99999999);
        const score = puntos * 1e12 + (9999 - Math.min(erros, 9999)) * 1e8 + (99999999 - cs);
        const [, , , posto, top] = await redis([
          ["ZADD", k, String(score), m],
          ["ZREMRANGEBYRANK", k, "0", String(-(GARDAR + 1))],
          ["EXPIRE", k, String(60 * 60 * 24 * 45)],
          ["ZREVRANK", k, m],
          ["ZRANGE", k, "0", String(AMOSAR - 1), "REV"],
        ]);
        return res.status(200).json({ id: entrada.id, posicion: posto === null ? null : posto + 1, top: lerTop(top) });
      }

      const nivel = b.nivel, zona = b.zona;
      const acertos = Math.floor(Number(b.acertos));
      const erros = Math.floor(Number(b.erros));
      const tempo = Math.floor(Number(b.tempo));

      if (!NIVEIS.includes(nivel) || !(zona in TOTAL)) return res.status(400).json({ erro: "Nivel ou zona non válidos." });
      const total = TOTAL[zona];
      if (!(acertos >= 1 && acertos <= total) || !(erros >= 0 && erros <= 100000) || !(tempo >= 1000 && tempo <= 36e6))
        return res.status(400).json({ erro: "Marca non válida." });
      if (tempo < acertos * 400) return res.status(400).json({ erro: "Marca non válida." }); // ninguén acerta tan rápido

      // Límite sinxelo: 20 envíos cada 10 minutos por IP
      const [envios] = await redis([["INCR", `concellos:limite:${ip}`], ["EXPIRE", `concellos:limite:${ip}`, "600"]]);
      if (envios > 20) return res.status(429).json({ erro: "Demasiados envíos. Proba máis tarde." });

      const entrada = { id: crypto.randomUUID(), alias, acertos, total, erros, tempo, data: new Date().toISOString().slice(0, 10) };
      const k = chave(nivel, zona), m = JSON.stringify(entrada);
      const [, , posto, top] = await redis([
        ["ZADD", k, String(puntuacion(acertos, erros, tempo)), m],
        ["ZREMRANGEBYRANK", k, "0", String(-(GARDAR + 1))],
        ["ZREVRANK", k, m],
        ["ZRANGE", k, "0", String(AMOSAR - 1), "REV"],
      ]);
      return res.status(200).json({ id: entrada.id, posicion: posto === null ? null : posto + 1, top: lerTop(top) });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ erro: "Método non permitido." });
  } catch (e) {
    return res.status(500).json({ erro: "Erro do servidor." });
  }
};
