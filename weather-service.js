// Weather via Open-Meteo (free, keyless, CORS-enabled). Real data only: when it can't be fetched we show the cached
// reading with its age, or an honest error — never placeholder numbers.
import { weather as store } from '../core/state.js';
import { bus } from '../core/util.js';

const TTL = 20 * 60 * 1000;
export const status = { loading: false, error: '' };
let inflight = null;

export function forecastUrl({ lat, lon }, units) {
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lon), timezone: 'auto', forecast_days: '2',
    current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code',
    temperature_unit: units === 'f' ? 'fahrenheit' : 'celsius', wind_speed_unit: units === 'f' ? 'mph' : 'kmh',
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

export function parseForecast(j) {
  const c = j?.current, d = j?.daily;
  if (!c || typeof c.temperature_2m !== 'number') throw new Error('Unexpected weather response');
  return {
    temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature ?? c.temperature_2m), code: c.weather_code, isDay: c.is_day !== 0,
    wind: Math.round(c.wind_speed_10m ?? 0), humidity: Math.round(c.relative_humidity_2m ?? 0),
    hi: d?.temperature_2m_max?.[0] != null ? Math.round(d.temperature_2m_max[0]) : null,
    lo: d?.temperature_2m_min?.[0] != null ? Math.round(d.temperature_2m_min[0]) : null,
    rain: d?.precipitation_probability_max?.[0] ?? null,
  };
}

export async function refresh({ force = false, fetchImpl = fetch } = {}) {
  const s = store.get();
  if (!s.loc) return null;
  const fresh = s.cache && Date.now() - s.cache.at < TTL && s.cache.units === s.units && s.cache.key === `${s.loc.lat},${s.loc.lon}`;
  if (fresh && !force) return s.cache.data;
  if (inflight) return inflight;
  status.loading = true; status.error = '';
  bus.emit('weather:status');
  inflight = (async () => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12000);
    try {
      const res = await fetchImpl(forecastUrl(s.loc, s.units), { signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = parseForecast(await res.json());
      store.set({ cache: { at: Date.now(), units: s.units, key: `${s.loc.lat},${s.loc.lon}`, data } });
      return data;
    } catch (e) {
      status.error = navigator.onLine === false ? 'Offline' : 'Couldn’t load weather';
      return null;
    } finally {
      clearTimeout(t);
      status.loading = false;
      inflight = null;
      bus.emit('weather:status');
    }
  })();
  return inflight;
}

export async function searchCity(name, fetchImpl = fetch) {
  const q = String(name || '').trim();
  if (q.length < 2) return [];
  const res = await fetchImpl(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: q, count: '5', language: 'en', format: 'json' })}`);
  if (!res.ok) throw new Error('search failed');
  const j = await res.json();
  return (j.results || []).map((r) => ({ name: [r.name, r.admin1, r.country_code].filter(Boolean).join(', '), short: r.name, lat: r.latitude, lon: r.longitude }));
}

export function setLocation(loc) {
  store.set({ loc: { name: loc.short || loc.name, lat: loc.lat, lon: loc.lon }, cache: null });
  return refresh({ force: true });
}

export function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location isn’t available on this device.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ name: 'My location', short: 'My location', lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3) }),
      () => reject(new Error('Location permission was denied.')),
      { timeout: 10000, maximumAge: 600000 },
    );
  });
}

export function setUnits(units) { store.set({ units, cache: null }); return refresh({ force: true }); }
