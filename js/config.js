// =====================================================================
// CONFIG — constantes centralizadas de la aplicación
// =====================================================================
// Cambiar aquí afecta toda la app; no hay valores mágicos dispersos.
// =====================================================================

const CONFIG = {
  // URLs base de las APIs (todas gratuitas, sin proxy)
  ESPN_BASE:   'https://site.api.espn.com/apis/site/v2/sports',
  ESPN_WEB:    'https://site.web.api.espn.com/apis',
  MLB_BASE:    'https://statsapi.mlb.com/api/v1',
  WEATHER_BASE:'https://api.openweathermap.org/data/2.5',

  // Timeouts de red
  FETCH_TIMEOUT_MS:   8_000,   // espera máxima por petición
  WEATHER_TIMEOUT_MS: 6_000,   // clima puede ser más lento

  // Refresco automático
  HOT_REFRESH_MS:    5  * 60 * 1000,   // cada 5 min para marcadores en vivo
  ODDS_REFRESH_MS:   30 * 60 * 1000,   // odds cada 30 min

  // Sistema ELO
  ELO_K_FACTOR: 32,
  ELO_BASE:     1500,

  // Umbrales de confianza del modelo
  CONF_HIGH_EDGE:       0.07,   // edge ≥ 7% → ALTA
  CONF_MED_EDGE:        0.03,   // edge ≥ 3% → MEDIA
  CONF_HIGH_AGREEMENT:  0.88,   // 88%+ señales de acuerdo → ALTA
  CONF_MED_AGREEMENT:   0.72,   // 72%+ señales de acuerdo → MEDIA

  // Parlay Builder
  PARLAY_MAX_LEGS: 8,

  // Clima (OpenWeather)
  WIND_OVER_THRESHOLD:   15,    // mph → efecto sobre totales MLB
  TEMP_COLD_THRESHOLD:   50,    // °F → efecto UNDER
};
