// Ranking do Reto: unha táboa por nivel e zona (toda Galicia ou unha provincia).
// Garda as marcas en Upstash Redis (conectado desde Vercel > Storage).
const crypto = require("crypto");

const NIVEIS = ["facil", "medio", "dificil", "perfecto"];
const TOTAL = { todo: 313, "15": 93, "27": 67, "32": 92, "36": 61 };
const URL_REDIS = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const GARDAR = 100; // marcas que se conservan por táboa
const AMOSAR = 20;  // marcas que se devolven

async function redis(comandos) {
  const r = await fetch(`${URL_REDIS}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(comandos),
  });
  if (!r.ok) throw new Error("Redis " + r.status);
  return (await r.json()).map(x => { if (x.error) throw new Error(x.error); return x.result; });
}

const chave = (nivel, zona) => `concellos:ranking:${nivel}:${zona}`;
const lerTop = lista => (lista || []).map(m => { try { return JSON.parse(m); } catch { return null; } }).filter(Boolean);

// Máis atopados, logo menos erros, logo menos tempo (en centésimas)
function puntuacion(acertos, erros, tempoMs) {
  const cs = Math.min(Math.round(tempoMs / 10), 99999999);
  return acertos * 1e12 + (9999 - Math.min(erros, 9999)) * 1e8 + (99999999 - cs);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!URL_REDIS || !TOKEN) return res.status(500).json({ erro: "Falta conectar a base de datos (Upstash Redis)." });

  try {
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
      const nivel = b.nivel, zona = b.zona;
      const alias = String(b.alias || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 20);
      const acertos = Math.floor(Number(b.acertos));
      const erros = Math.floor(Number(b.erros));
      const tempo = Math.floor(Number(b.tempo));

      if (!NIVEIS.includes(nivel) || !(zona in TOTAL)) return res.status(400).json({ erro: "Nivel ou zona non válidos." });
      if (!alias) return res.status(400).json({ erro: "Falta o alias." });
      const total = TOTAL[zona];
      if (!(acertos >= 1 && acertos <= total) || !(erros >= 0 && erros <= 100000) || !(tempo >= 1000 && tempo <= 36e6))
        return res.status(400).json({ erro: "Marca non válida." });
      if (tempo < acertos * 400) return res.status(400).json({ erro: "Marca non válida." }); // ninguén acerta tan rápido

      // Límite sinxelo: 20 envíos cada 10 minutos por IP
      const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "descoñecida";
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
