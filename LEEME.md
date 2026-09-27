# Concellos de Galicia

Juego web para localizar los 313 concellos de Galicia.

## Archivos
- `index.html`: el juego completo.
- `api/ranking.js`: función de Vercel que guarda y devuelve los rankings (Reto y Reto diario).
- `api/vacas.js`: función de Vercel para las partidas a dos de "Onde teño as vacas?" (estado en Redis, caduca a las 12 h).
- `favicon.svg`, `apple-touch-icon.png`, `og-image.png`: iconos y vista previa para compartir.

## Puesta en marcha
1. Sube esta carpeta a un repositorio de GitHub e impórtalo en Vercel (no necesita compilación; Vercel instala `redis` desde `package.json`).
2. Reutiliza tu base de datos Redis: en Vercel, Storage > tu base de datos Redis > Connect Project > elige el proyecto de los concellos.
   Así el proyecto recibe la variable `REDIS_URL`. Las claves del ranking empiezan por `concellos:`, así que no chocan con los datos de otros proyectos.
   (También funciona con Upstash, con `KV_REST_API_URL` y `KV_REST_API_TOKEN`.)
3. Vuelve a desplegar para que la función lea la variable.
4. La dirección publicada es `https://concellosgz.vercel.app`; las etiquetas `og:url` y `og:image` de `index.html` ya apuntan ahí.

## Ranking
- Solo en el modo Reto, al terminar la partida, con toda Galicia o una sola provincia.
- Una tabla por nivel (Fácil, Medio, Difícil, Perfecto) y zona (Toda Galicia, A Coruña, Lugo, Ourense, Pontevedra).
- Orden: más concellos encontrados, después menos errores y, en caso de empate, menos tiempo.
- Se guardan las 100 mejores marcas de cada tabla y se muestran las 20 primeras.

## Reto diario
- Cada día (hora de Galicia) salen los mismos 10 concellos para todo el mundo; una sola oportunidad al día.
- Reglas de nivel Medio: 3 intentos y pistas por comarcas. Puntos 3/2/1 según el intento.
- Ranking del día: más puntos, luego menos errores, luego menos tiempo. Cada tabla se borra sola a los 45 días.
- Al terminar se puede compartir el resultado con cuadrados de colores (🟩 a la primera, 🟨 con fallos, 🟥 no encontrado).

## Onde teño as vacas?
- **2 jugadores:** turnos alternos, ambos conectados. Cada uno esconde 6 vacas (no vecinas entre sí) y ataca las del otro. Vaca / pasto (vaca vecina) / tierra. Gana quien encuentra antes las 6.
- **3 o 4 jugadores:** mapa común y rondas simultáneas de 40 segundos (constante `TEMPO_ROLDA` en `api/vacas.js`). Cada uno esconde 5 vacas (3 jugadores) o 4 (4 jugadores) y tira una vez por ronda; los resultados se revelan al cerrar la ronda. Un punto por cada vaca ajena encontrada; gana quien más puntos tiene cuando solo queda un equipo con vacas (o a las 40 rondas), y en empate quien menos vacas perdió. Quien no tira a tiempo pierde esa tirada.
- Se crea una sala (código de 4 letras); los demás entran con el código o con el enlace `?sala=CODIGO`. Con 4 plazas, el creador puede empezar con 3.
- Razas para elegir equipo: Rubia galega, Cachena, Frisona y Milka. Las partidas caducan a las 12 h.
