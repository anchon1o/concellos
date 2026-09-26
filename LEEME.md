# Concellos de Galicia

Juego web para localizar los 313 concellos de Galicia.

## Archivos
- `index.html`: el juego completo.
- `api/ranking.js`: función de Vercel que guarda y devuelve el ranking del Reto.
- `favicon.svg`, `apple-touch-icon.png`, `og-image.png`: iconos y vista previa para compartir.

## Puesta en marcha
1. Sube esta carpeta a un repositorio de GitHub e impórtalo en Vercel (no necesita compilación; Vercel instala `redis` desde `package.json`).
2. Reutiliza tu base de datos Redis: en Vercel, Storage > tu base de datos Redis > Connect Project > elige el proyecto de los concellos.
   Así el proyecto recibe la variable `REDIS_URL`. Las claves del ranking empiezan por `concellos:`, así que no chocan con los datos de otros proyectos.
   (También funciona con Upstash, con `KV_REST_API_URL` y `KV_REST_API_TOKEN`.)
3. Vuelve a desplegar para que la función lea la variable.
4. Si la dirección final no es `concellos.vercel.app`, cambia la etiqueta `og:image` de `index.html` para que apunte a la tuya.

## Ranking
- Solo en el modo Reto, al terminar la partida, con toda Galicia o una sola provincia.
- Una tabla por nivel (Fácil, Medio, Difícil, Perfecto) y zona (Toda Galicia, A Coruña, Lugo, Ourense, Pontevedra).
- Orden: más concellos encontrados, después menos errores y, en caso de empate, menos tiempo.
- Se guardan las 100 mejores marcas de cada tabla y se muestran las 20 primeras.
