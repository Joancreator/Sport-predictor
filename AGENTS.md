# AGENTS.md

Guía para Codex al trabajar en este repositorio.

## Visión del producto

Plataforma de análisis deportivo para MLB y NBA. El objetivo es mostrar predicciones honestas basadas en datos reales: forma reciente de equipos y jugadores, líneas de apuestas, y métricas objetivas. **Nunca inventar estadísticas. Nunca fabricar confianza.**

## Forma del proyecto

Una sola aplicación: **todo vive en `index.html`** (HTML + CSS en `<style>` + JS en `<script>`). Sin build step, sin package.json, sin framework. Única dependencia externa: Chart.js desde CDN.

Comentarios y textos de la UI están en **español**. El usuario es principiante — preservar los comentarios explicativos en español al editar y escribir los nuevos en el mismo estilo.

## Cómo ejecutar

```
npx serve -p 3000 .
```

Abrir `http://localhost:3000`. No hay comandos de test, lint ni build — `index.html` es el entregable.

## Arquitectura

### Secciones (SPA sin router)
El body tiene elementos `<section id="section-…">` hermanos: `home`, `nba`, `mlb`, `predictions`, `history`, `equipos`, `player`. `showSection(name, linkElement)` alterna la clase `.active`. La sección `player` es una vista de detalle accesible desde búsqueda; `goBackFromPlayer()` regresa a la sección anterior.

### Fuentes de datos (todas CORS-open, sin proxy)
- **ESPN** (`site.api.espn.com`) — marcadores NBA, búsqueda de jugadores, perfil de atleta, gamelog. Sin llave. Fuente principal NBA.
- **MLB Stats API** (`statsapi.mlb.com`) — juegos MLB, jugadores, splits, gamelogs. Sin llave.
- **The Odds API** — spreads / moneylines / totals reales. Llave hardcodeada como `ODDS_API_KEY` cerca de `loadOdds()`. Sport keys: `basketball_nba`, `baseball_mlb`. Matched a juegos ESPN via `teamLastWord()`.

**No reintroducir** balldontlie ni intentar hacer proxy de stats.nba.com — ambos descartados definitivamente.

### Parseo del gamelog ESPN (NBA)
`parseGameStats(statsArr)` decodifica el array paralelo `stats`. Orden fijo: `[MIN, FG, FG%, 3PT, 3P%, FT, FT%, REB, AST, BLK, STL, PF, TO, PTS]`. Made/attempted vienen como strings `"8-20"` — `parseMA()` los divide.

`loadNBAPlayer()` recorre **todos** los `seasonTypes[]` (temporada regular Y playoffs), marcando cada juego con `isPlayoffs`. Juegos ordenados por fecha desc, últimos 15. No filtrar solo temporada regular — los playoffs deben aparecer.

### Patrón de gráficas (mutar, no recrear)
`playerCharts.nba` se crea una vez en `renderNBAPlayer`. Los botones de stat (PTS/REB/AST/STL/BLK) llaman `switchNBAStat(key)` que muta `data.datasets[0].data` + `[1].data` y llama `.update()`. El estado compartido vive en `currentNBAGamesData = { games, avgs }`. Seguir este mismo patrón para cualquier gráfica nueva.

### Renderizado de odds
Cada card de juego tiene dos slots `.odds-value` por mercado con `data-odds="away-spread"` / `"home-spread"` etc. `loadOdds()` escribe ambos lados via `container.querySelector('[data-odds="…"]')`. Siempre mantener el par away/home al agregar mercados nuevos.

## Secciones pendientes

### `section-equipos` (antes `section-injuries`)
Vista de perfil de equipo que espeja la UI del perfil de jugador: header con logo y nombre, grid de estadísticas de equipo, últimos N juegos, splits, botones de filtro de stat via `switchTeamStat()`. Usar endpoints ESPN: `…/teams`, `…/teams/{id}/statistics`, `…/teams/{id}/schedule`.

### `section-predictions` — PRIORIDAD PRINCIPAL
La sección más importante. Debe combinar varias fuentes para producir un análisis real:

**Datos a combinar:**
- Juegos del día (ESPN/MLB Stats API)
- Odds actuales (The Odds API) → probabilidad implícita = `1 / oddDecimal`
- Forma reciente del equipo: W/L últimos 10 juegos, puntos/carreras promedio anotados y permitidos
- Estadísticas de jugadores clave (últimos 5–10 juegos)
- Head-to-head reciente si está disponible

**Métricas a calcular y mostrar:**
- `Probabilidad implícita` de las odds (convierte American odds a %)
- `Forma reciente` (últimos 5 y 10 juegos, % victorias)
- `Edge estimado`: diferencia entre probabilidad implícita y probabilidad calculada por forma
- `Nivel de confianza`: Alto / Medio / Bajo según convergencia de señales
  - Alto: forma + stats de jugadores + odds apuntan al mismo lado
  - Medio: 2 de 3 señales coinciden
  - Bajo: señales contradictorias o datos insuficientes

**Lo que mostrar por juego:**
- Card con ambos equipos, hora, deporte
- Odds actuales (spread + moneyline + total)
- Probabilidad implícita vs probabilidad estimada
- Pick recomendado con justificación breve en texto
- Badge de confianza (verde/amarillo/rojo)
- Advertencia si los datos son insuficientes para predecir

**Principio de integridad:** Si no hay datos suficientes, mostrar "Datos insuficientes" en lugar de inventar una predicción. La confianza es una medida honesta, no marketing.

## Restricciones

- Los navegadores bloquean los headers `Host`, `Referer`, `Origin`, `User-Agent` — nunca escribir código que los setee.
- Sin build step. No introducir npm, bundlers, TypeScript ni frameworks salvo que el usuario lo pida explícitamente.
- Todo en `index.html` salvo que el usuario pida dividir archivos.
- Diseño: dark UI, consistente con el estilo actual. No cambiar colores o layout general sin que el usuario lo pida.
