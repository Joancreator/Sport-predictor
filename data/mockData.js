// =====================================================================
// MOCK DATA — datos de respaldo y constantes estáticas
// =====================================================================

// Coordenadas lat/lon de los 30 estadios MLB (para clima).
// Retractable roof = null (clima irrelevante).
const MLB_STADIUM_COORDS = {
  // AL East
  'Yankees':       { lat: 40.8296, lon: -73.9262, name: 'Yankee Stadium' },
  'Red Sox':       { lat: 42.3467, lon: -71.0972, name: 'Fenway Park' },
  'Rays':          { lat: 27.7683, lon: -82.6534, name: 'Tropicana Field', roof: true },
  'Blue Jays':     { lat: 43.6414, lon: -79.3894, name: 'Rogers Centre', roof: true },
  'Orioles':       { lat: 39.2838, lon: -76.6218, name: 'Oriole Park at Camden Yards' },
  // AL Central
  'White Sox':     { lat: 41.8300, lon: -87.6338, name: 'Guaranteed Rate Field' },
  'Guardians':     { lat: 41.4962, lon: -81.6852, name: 'Progressive Field' },
  'Tigers':        { lat: 42.3390, lon: -83.0485, name: 'Comerica Park' },
  'Royals':        { lat: 39.0517, lon: -94.4803, name: 'Kauffman Stadium' },
  'Twins':         { lat: 44.9817, lon: -93.2778, name: 'Target Field' },
  // AL West
  'Astros':        { lat: 29.7573, lon: -95.3555, name: 'Minute Maid Park', roof: true },
  'Angels':        { lat: 33.8003, lon: -117.8827, name: 'Angel Stadium' },
  'Athletics':     { lat: 37.7516, lon: -122.2005, name: 'Oakland Coliseum' },
  'Mariners':      { lat: 47.5914, lon: -122.3325, name: 'T-Mobile Park', roof: true },
  'Rangers':       { lat: 32.7473, lon: -97.0845, name: 'Globe Life Field', roof: true },
  // NL East
  'Braves':        { lat: 33.8908, lon: -84.4677, name: 'Truist Park' },
  'Marlins':       { lat: 25.7781, lon: -80.2197, name: 'loanDepot park', roof: true },
  'Mets':          { lat: 40.7571, lon: -73.8458, name: 'Citi Field' },
  'Phillies':      { lat: 39.9056, lon: -75.1665, name: 'Citizens Bank Park' },
  'Nationals':     { lat: 38.8731, lon: -77.0074, name: 'Nationals Park' },
  // NL Central
  'Cubs':          { lat: 41.9484, lon: -87.6553, name: 'Wrigley Field' },
  'Reds':          { lat: 39.0979, lon: -84.5082, name: 'Great American Ball Park' },
  'Brewers':       { lat: 43.0283, lon: -87.9712, name: 'American Family Field', roof: true },
  'Pirates':       { lat: 40.4469, lon: -80.0057, name: 'PNC Park' },
  'Cardinals':     { lat: 38.6226, lon: -90.1928, name: 'Busch Stadium' },
  // NL West
  'Diamondbacks':  { lat: 33.4453, lon: -112.0667, name: 'Chase Field', roof: true },
  'Rockies':       { lat: 39.7560, lon: -104.9942, name: 'Coors Field' },
  'Dodgers':       { lat: 34.0739, lon: -118.2400, name: 'Dodger Stadium' },
  'Padres':        { lat: 32.7073, lon: -117.1566, name: 'Petco Park' },
  'Giants':        { lat: 37.7786, lon: -122.3893, name: 'Oracle Park' },
};

// Busca el estadio por nombre parcial del equipo (last word o full name)
function getStadiumCoords(teamName) {
  if (!teamName) return null;
  const last = teamName.trim().split(' ').pop();
  // Buscar por última palabra del nombre
  for (const [key, val] of Object.entries(MLB_STADIUM_COORDS)) {
    if (key.toLowerCase() === last.toLowerCase()) return val;
  }
  // Buscar por nombre completo parcial
  for (const [key, val] of Object.entries(MLB_STADIUM_COORDS)) {
    if (teamName.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return null;
}
