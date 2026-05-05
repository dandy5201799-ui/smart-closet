/**
 * 生成搭配前的「今日日期 + 地点 + 天气」上下文（浏览器端 Open-Meteo，无需密钥）。
 * 跨端：依赖安全上下文下的 geolocation；失败则默认城市或无天气兜底。
 */

const GEO_TIMEOUT_MS = 8_000;
const FETCH_TIMEOUT_MS = 10_000;

export type OutfitWeatherPromptContext = {
  /** 给 Kimi 的一行摘要（日期 + 地点） */
  headline: string;
  /** 气温、天气现象、湿度、风等 */
  detail: string;
};

export type OutfitWeatherFetchResult = {
  context: OutfitWeatherPromptContext | null;
  /** 可选：给用户看的简短说明（定位/兜底） */
  toastMessage?: string;
};

function defaultCityFromEnv(): string {
  const v = String(import.meta.env.VITE_OUTFIT_DEFAULT_CITY ?? "").trim();
  return v;
}

function fetchSignal(): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(FETCH_TIMEOUT_MS);
  }
  const c = new AbortController();
  window.setTimeout(() => c.abort(), FETCH_TIMEOUT_MS);
  return c.signal;
}

function wmoWeatherCodeZh(code: number): string {
  const c = Math.round(code);
  if (c === 0) return "晴";
  if (c === 1) return "大部晴朗";
  if (c === 2) return "多云";
  if (c === 3) return "阴";
  if (c === 45 || c === 48) return "雾";
  if (c >= 51 && c <= 55) return "小毛毛雨或细雨";
  if (c === 56 || c === 57) return "冻毛毛雨";
  if (c === 61 || c === 63 || c === 65) return "雨";
  if (c === 66 || c === 67) return "冻雨";
  if (c === 71 || c === 73 || c === 75) return "降雪";
  if (c === 77) return "雪粒";
  if (c === 80 || c === 81 || c === 82) return "阵雨";
  if (c === 85 || c === 86) return "阵雪";
  if (c === 95) return "雷雨";
  if (c === 96 || c === 99) return "雷雨伴冰雹";
  return "其它天气现象";
}

function windSpeedZh(mps: number): string {
  if (mps < 0.5) return "几乎无风";
  if (mps < 3.4) return "微风";
  if (mps < 8) return "和风";
  if (mps < 14) return "清风";
  if (mps < 21) return "强风";
  return "大风";
}

function formatCoordLabel(lat: number, lon: number): string {
  const ns = lat >= 0 ? "北纬" : "南纬";
  const ew = lon >= 0 ? "东经" : "西经";
  return `${ns} ${Math.abs(lat).toFixed(1)}°，${ew} ${Math.abs(lon).toFixed(1)}°`;
}

function getPosition(timeoutMs: number): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("no_geolocation"));
      return;
    }
    const t = window.setTimeout(() => reject(new Error("geo_timeout")), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(t);
        resolve(pos);
      },
      () => {
        window.clearTimeout(t);
        reject(new Error("geo_denied"));
      },
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: timeoutMs }
    );
  });
}

type GeoHit = { latitude: number; longitude: number; label: string };

async function geocodeCityName(city: string): Promise<GeoHit | null> {
  const q = encodeURIComponent(city);
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=zh`;
  const res = await fetch(url, { signal: fetchSignal() });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    results?: { latitude: number; longitude: number; name: string; admin1?: string }[];
  };
  const r = data.results?.[0];
  if (!r) return null;
  const label = [r.name, r.admin1].filter(Boolean).join(" · ") || r.name;
  return { latitude: r.latitude, longitude: r.longitude, label };
}

async function fetchCurrentWeather(lat: number, lon: number, locationLine: string): Promise<OutfitWeatherPromptContext> {
  const u = new URL("https://api.open-meteo.com/v1/forecast");
  u.searchParams.set("latitude", String(lat));
  u.searchParams.set("longitude", String(lon));
  u.searchParams.set("current", "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m");
  u.searchParams.set("timezone", "auto");
  const res = await fetch(u.toString(), { signal: fetchSignal() });
  if (!res.ok) throw new Error("forecast_http");
  const data = (await res.json()) as {
    timezone?: string;
    current?: {
      temperature_2m?: number;
      relative_humidity_2m?: number;
      weather_code?: number;
      wind_speed_10m?: number;
    };
  };
  const cur = data.current;
  if (!cur || typeof cur.temperature_2m !== "number") throw new Error("forecast_shape");

  const today = new Date().toLocaleDateString("zh-CN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const wx = wmoWeatherCodeZh(Number(cur.weather_code ?? 0));
  const temp = Math.round(cur.temperature_2m);
  const hum = cur.relative_humidity_2m != null ? `${Math.round(cur.relative_humidity_2m)}%` : "未知";
  const wind = cur.wind_speed_10m != null ? windSpeedZh(Number(cur.wind_speed_10m)) : "未知";
  const tz = data.timezone ? `（时区：${data.timezone}）` : "";

  const headline = `今日日期：${today}。地点：${locationLine}${tz}`;
  const detail = `当前实况：气温约 ${temp}°C，天气「${wx}」，相对湿度约 ${hum}，风力约 ${wind}。请据此考虑薄厚、是否需要外套/防风/防雨倾向。`;

  return { headline, detail };
}

/** 从实况文案解析简短「温度带 + 天气」标签，供搭配卡片展示或 Kimi 兜底 */
export function deriveOutfitClimateLabels(ctx: OutfitWeatherPromptContext): {
  suitableTempRange: string;
  suitableWeather: string;
} {
  const tempM = ctx.detail.match(/气温约\s*(-?\d+)\s*°C/);
  const wxM = ctx.detail.match(/天气「([^」]+)」/);
  const humM = ctx.detail.match(/相对湿度约\s*([^，]+)/);
  const windM = ctx.detail.match(/风力约\s*([^。]+)/);
  const t = tempM ? Number.parseInt(tempM[1], 10) : NaN;
  const wx = wxM ? wxM[1].trim() : "未知";
  const hum = humM ? humM[1].trim() : "";
  const wind = windM ? windM[1].trim() : "";
  const range =
    Number.isFinite(t) && !Number.isNaN(t)
      ? `约 ${Math.max(-20, t - 4)}°C～${t + 4}°C（参考当日实况）`
      : "请参考当日实况气温";
  const weatherBits = [wx, hum && `湿度 ${hum}`, wind && wind !== "未知" ? `风力 ${wind}` : ""].filter(Boolean);
  return {
    suitableTempRange: range,
    suitableWeather: weatherBits.join(" · "),
  };
}

/**
 * 在用户手势（如点击「生成搭配」）后调用：先尝试定位，再拉 Open-Meteo；失败则用 VITE_OUTFIT_DEFAULT_CITY 或返回 null。
 */
export async function getOutfitWeatherContext(): Promise<OutfitWeatherFetchResult> {
  const todayShort = new Date().toLocaleDateString("zh-CN");
  let toastMessage: string | undefined;

  const secure =
    typeof window !== "undefined" &&
    (window.isSecureContext || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  try {
    let hit: GeoHit | null = null;

    if (secure && navigator.geolocation) {
      try {
        const pos = await getPosition(GEO_TIMEOUT_MS);
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        hit = {
          latitude: lat,
          longitude: lon,
          label: `当前定位（${formatCoordLabel(lat, lon)}）`,
        };
      } catch {
        const city = defaultCityFromEnv();
        if (city) {
          const g = await geocodeCityName(city);
          if (g) {
            hit = { ...g, label: `默认城市：${g.label}` };
            toastMessage = `未获取到定位或已拒绝定位，已使用默认城市「${city}」查询天气。`;
          } else {
            toastMessage = "无法解析 VITE_OUTFIT_DEFAULT_CITY，请检查城市名称。";
          }
        } else {
          toastMessage = "未获取到定位。可在 .env 中设置 VITE_OUTFIT_DEFAULT_CITY（如 上海）以便查询天气。";
        }
      }
    } else {
      const city = defaultCityFromEnv();
      if (city) {
        const g = await geocodeCityName(city);
        if (g) {
          hit = { ...g, label: `默认城市：${g.label}` };
          toastMessage = `当前页面非安全来源（需 https 或 localhost），已使用默认城市「${city}」查询天气。`;
        } else {
          toastMessage = "无法解析默认城市名称，请检查 VITE_OUTFIT_DEFAULT_CITY。";
        }
      } else {
        toastMessage = "当前无法使用定位（需 https 或 localhost）。可在 .env 中设置 VITE_OUTFIT_DEFAULT_CITY。";
      }
    }

    if (!hit) {
      return { context: null, toastMessage };
    }

    const context = await fetchCurrentWeather(hit.latitude, hit.longitude, hit.label);
    return { context, toastMessage };
  } catch {
    return {
      context: null,
      toastMessage: `未能获取实时天气（${todayShort}），将按季节与通用通勤场景搭配。`,
    };
  }
}
