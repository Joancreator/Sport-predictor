// =====================================================================
// WEATHER — señal climática para partidos MLB en estadios al aire libre
// =====================================================================
// Usa OpenWeather API (gratuita hasta 1,000 llamadas/día).
// La llave la ingresa el usuario y se guarda en localStorage.
// =====================================================================

const WEATHER_KEY_STORAGE = 'sp_openweather_key';

function getWeatherKey() {
  return localStorage.getItem(WEATHER_KEY_STORAGE) || '';
}

function saveWeatherKey(key) {
  localStorage.setItem(WEATHER_KEY_STORAGE, key.trim());
}

// Obtiene el clima actual para unas coordenadas lat/lon.
// Devuelve { tempF, windMph, windDir, rain, snow, description } o null si falla.
async function fetchWeather(lat, lon) {
  const key = getWeatherKey();
  if (!key) return null;
  try {
    const base = (typeof CONFIG !== 'undefined' ? CONFIG.WEATHER_BASE : 'https://api.openweathermap.org/data/2.5');
    const ms   = (typeof CONFIG !== 'undefined' ? CONFIG.WEATHER_TIMEOUT_MS : 6000);
    const r = await fetchWithTimeout(
      `${base}/weather?lat=${lat}&lon=${lon}&appid=${key}&units=imperial`,
      ms
    );
    if (!r.ok) return null;
    const d = await r.json();
    return {
      tempF:       Math.round(d.main?.temp ?? 72),
      windMph:     Math.round((d.wind?.speed ?? 0) * 1),
      windDeg:     d.wind?.deg ?? 0,        // grados (0=N, 90=E, 180=S, 270=W)
      rain:        (d.rain?.['1h'] ?? 0) > 0.1,
      snow:        (d.snow?.['1h'] ?? 0) > 0.1,
      description: d.weather?.[0]?.description || '',
    };
  } catch { return null; }
}

// Calcula la señal climática para MLB.
// Devuelve { adjustment, description } donde adjustment es ±% sobre homeEstP.
// Solo aplica en estadios al aire libre (sin techo retráctil).
function calcWeatherSignal(weather, stadiumCoords) {
  if (!weather || stadiumCoords?.roof) return null;

  const windThreshold = (typeof CONFIG !== 'undefined' ? CONFIG.WIND_OVER_THRESHOLD : 15);
  const coldThreshold = (typeof CONFIG !== 'undefined' ? CONFIG.TEMP_COLD_THRESHOLD : 50);

  let adj = 0;
  const notes = [];

  // Temperatura: frío reduce totales (menos home runs)
  if (weather.tempF < coldThreshold) {
    adj -= 0.01; notes.push(`Frío (${weather.tempF}°F)`);
  }

  // Viento fuerte → más varianza → ligero Over bias en totales
  if (weather.windMph > windThreshold) {
    adj += 0.015; notes.push(`Viento ${weather.windMph} mph`);
  }
  if (weather.windMph > 25) {
    adj += 0.01; notes.push('Viento muy fuerte');
  }

  // Lluvia/nieve → mayor incertidumbre → reducir confianza (devolvemos flag)
  const precipitation = weather.rain || weather.snow;
  if (precipitation) {
    notes.push(weather.rain ? 'Lluvia' : 'Nieve');
  }

  return {
    adj,
    precipitation,
    description: notes.join(', ') || 'Condiciones normales',
    weather
  };
}

// Renderiza un mini badge de clima para la card de predicción
function renderWeatherBadge(weatherSignal) {
  if (!weatherSignal) return '';
  const { weather, precipitation, description } = weatherSignal;
  if (!weather) return '';

  const icon = precipitation ? '🌧' : weather.tempF < 45 ? '🥶' : weather.windMph > 20 ? '💨' : '☀';
  return `<span class="weather-badge" title="${description}">${icon} ${weather.tempF}°F · ${weather.windMph}mph</span>`;
}
