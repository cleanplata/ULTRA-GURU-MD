"use strict";

// Optional API integrations for Ultra Guru MD.
// No-key APIs work immediately. Keyed APIs fail gracefully when their key is absent.
const axios = require("axios");
const { gmd } = require("../guru");

const HTTP_TIMEOUT = 15000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const http = axios.create({
  timeout: HTTP_TIMEOUT,
  maxContentLength: MAX_RESPONSE_BYTES,
  maxBodyLength: MAX_RESPONSE_BYTES,
  headers: { "User-Agent": "Ultra-Guru-MD/5.0 (WhatsApp bot)" },
});
const env = (name) => String(process.env[name] || "").trim();
const clean = (value, max = 900) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const number = (value) => Number(String(value).replace(/,/g, ""));
async function getJson(url, options = {}) {
  const response = await http.get(url, { ...options, responseType: "json" });
  return response.data;
}
async function postJson(url, data, options = {}) {
  const response = await http.post(url, data, {
    ...options,
    responseType: "json",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  return response.data;
}
function apiKeyMessage(name, variable) {
  return `${name} needs an API key. Add ${variable} to your hosting environment, then restart the bot.`;
}
let nextNominatimRequest = 0;
async function nominatimSearch(query) {
  const wait = nextNominatimRequest - Date.now();
  if (wait > 0) await sleep(wait);
  nextNominatimRequest = Date.now() + 1000;
  return getJson("https://nominatim.openstreetmap.org/search", {
    params: { q: query, format: "jsonv2", limit: 3 },
    headers: { "User-Agent": "Ultra-Guru-MD/5.0 (contact bot owner)" },
  });
}

// .freeweather Nairobi — Open-Meteo, no key required.
gmd({ pattern: "freeweather", aliases: ["omweather", "weatherfree"], react: "🌤️", category: "api", description: "Free weather forecast using Open-Meteo" }, async (from, Guru, ctx) => {
  const { q, reply, react } = ctx;
  if (!q?.trim()) return reply("Usage: .freeweather <city>");
  try {
    const locations = await getJson("https://geocoding-api.open-meteo.com/v1/search", { params: { name: q.trim(), count: 1, language: "en", format: "json" } });
    const place = locations?.results?.[0];
    if (!place) return reply(`No location found for: ${clean(q, 80)}`);
    const weather = await getJson("https://api.open-meteo.com/v1/forecast", { params: {
      latitude: place.latitude, longitude: place.longitude,
      current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
      daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      forecast_days: 3, timezone: "auto",
    } });
    const c = weather.current || {}, d = weather.daily || {};
    await react("✅");
    return reply(`*Weather: ${place.name}, ${place.country || ""}*\n\n🌡️ Temperature: ${c.temperature_2m ?? "-"}°C\n🤗 Feels like: ${c.apparent_temperature ?? "-"}°C\n💧 Humidity: ${c.relative_humidity_2m ?? "-"}%\n💨 Wind: ${c.wind_speed_10m ?? "-"} km/h\n📅 3-day highs: ${(d.temperature_2m_max || []).join(", ")}°C\n🌧️ Rain probability: ${(d.precipitation_probability_max || []).join(", ")}%\n\nPowered by Open-Meteo`);
  } catch (error) {
    console.error("Free weather error:", error.message);
    return reply("Weather service is temporarily unavailable. Please try again later.");
  }
});

// .fx 100 USD KES — Frankfurter, no key required.
gmd({ pattern: "fx", aliases: ["frankfurter", "freerate"], react: "💱", category: "api", description: "Convert currencies with Frankfurter" }, async (from, Guru, ctx) => {
  const { q, reply, react } = ctx;
  const parts = q.trim().split(/\s+/);
  if (parts.length < 3) return reply("Usage: .fx <amount> <from> <to>\nExample: .fx 100 USD KES");
  const amount = number(parts[0]), base = parts[1].toUpperCase(), quote = parts[2].toUpperCase();
  if (!Number.isFinite(amount) || amount < 0) return reply("Please provide a valid amount.");
  try {
    const data = await getJson(`https://api.frankfurter.dev/v2/rate/${encodeURIComponent(base)}/${encodeURIComponent(quote)}`);
    const result = amount * Number(data.rate);
    await react("✅");
    return reply(`💱 *Currency conversion*\n\n${amount} ${base} = *${result.toFixed(2)} ${quote}*\nRate: ${data.rate}\n\nPowered by Frankfurter`);
  } catch (error) {
    console.error("FX error:", error.message);
    return reply("Could not find that currency pair. Example: .fx 100 USD KES");
  }
});

// .jokeapi — JokeAPI, no key required.
gmd({ pattern: "jokeapi", aliases: ["safejoke"], react: "😂", category: "api", description: "Get a safe joke from JokeAPI" }, async (from, Guru, ctx) => {
  const { reply, react } = ctx;
  try {
    const data = await getJson("https://v2.jokeapi.dev/joke/Any", { params: { blacklistFlags: "nsfw,religious,political,racist,sexist,explicit", "safe-mode": "" } });
    if (data.error) return reply("Joke service returned an error.");
    await react("✅");
    return reply(data.type === "twopart" ? `😂 ${data.setup}\n\n... ${data.delivery}` : `😂 ${data.joke}`);
  } catch (error) {
    console.error("JokeAPI error:", error.message);
    return reply("Joke service is temporarily unavailable.");
  }
});

// .meal chicken / .meal random — TheMealDB, test key 1.
gmd({ pattern: "meal", aliases: ["recipe", "themeal"], react: "🍲", category: "api", description: "Find a meal or recipe from TheMealDB" }, async (from, Guru, ctx) => {
  const { q, reply, react } = ctx;
  try {
    const endpoint = q?.trim() ? "search.php" : "random.php";
    const data = await getJson(`https://www.themealdb.com/api/json/v1/1/${endpoint}`, q?.trim() ? { params: { s: q.trim() } } : {});
    const meal = data?.meals?.[0];
    if (!meal) return reply("No meal found. Try another ingredient or name.");
    await react("✅");
    return reply(`🍲 *${meal.strMeal}*\n\nCategory: ${meal.strCategory || "-"}\nArea: ${meal.strArea || "-"}\n\n${clean(meal.strInstructions, 1200)}\n\nRecipe image: ${meal.strMealThumb || "-"}`);
  } catch (error) {
    console.error("MealDB error:", error.message);
    return reply("Recipe service is temporarily unavailable.");
  }
});

// .crypto btc / .coin ethereum — CoinGecko Demo/keyless API.
gmd({ pattern: "crypto", aliases: ["coin", "coinprice"], react: "🪙", category: "api", description: "Get a cryptocurrency price from CoinGecko" }, async (from, Guru, ctx) => {
  const { q, reply, react } = ctx;
  const coin = (q || "bitcoin").trim().toLowerCase();
  const options = { params: { ids: coin, vs_currencies: "usd" } };
  if (env("COINGECKO_API_KEY")) options.headers = { "x-cg-demo-api-key": env("COINGECKO_API_KEY") };
  try {
    const data = await getJson("https://api.coingecko.com/api/v3/simple/price", options);
    const price = data?.[coin]?.usd;
    if (price === undefined) return reply(`Coin not found: ${clean(coin, 60)}`);
    await react("✅");
    return reply(`🪙 *${coin}*\n\nUSD price: *$${Number(price).toLocaleString()}*\n\nData by CoinGecko`);
  } catch (error) {
    console.error("CoinGecko error:", error.message);
    return reply("Crypto service is rate-limited or unavailable. Add COINGECKO_API_KEY for a stable Demo plan.");
  }
});

// .ftranslate es Hello world — LibreTranslate hosted or self-hosted.
gmd({ pattern: "ftranslate", aliases: ["translatelite"], react: "🌍", category: "api", description: "Translate text with LibreTranslate" }, async (from, Guru, ctx) => {
  const { q, reply, react } = ctx;
  const parts = q.trim().split(/\s+/);
  if (parts.length < 2) return reply("Usage: .ftranslate <target-language> <text>\nExample: .ftranslate es Good morning");
  const target = parts.shift().toLowerCase(), text = parts.join(" ");
  const url = `${env("LIBRETRANSLATE_URL") || "https://libretranslate.com"}/translate`;
  const body = { q: text, source: "auto", target, format: "text" };
  if (env("LIBRETRANSLATE_API_KEY")) body.api_key = env("LIBRETRANSLATE_API_KEY");
  try {
    const data = await postJson(url, body);
    await react("✅");
    return reply(`🌍 *Translation (${target})*\n\n${clean(data.translatedText, 1800)}`);
  } catch (error) {
    console.error("LibreTranslate error:", error.message);
    return reply(`${apiKeyMessage("LibreTranslate", "LIBRETRANSLATE_API_KEY")} You can also set LIBRETRANSLATE_URL to your own self-hosted server.`);
  }
});

// .fnews bitcoin — NewsAPI. Requires NEWSAPI_KEY for the free developer plan.
gmd({ pattern: "fnews", aliases: ["newsapi", "apinews"], react: "📰", category: "api", description: "Search news with NewsAPI" }, async (from, Guru, ctx) => {
  const { q, reply, react } = ctx;
  if (!env("NEWSAPI_KEY")) return reply(apiKeyMessage("NewsAPI", "NEWSAPI_KEY"));
  try {
    const data = await getJson("https://newsapi.org/v2/everything", { params: { q: q?.trim() || "technology", language: "en", pageSize: 5, apiKey: env("NEWSAPI_KEY") } });
    if (data.status !== "ok") return reply("News service returned an error.");
    const items = (data.articles || []).slice(0, 5).map((a, i) => `${i + 1}. *${clean(a.title, 180)}*\n${a.url}`).join("\n\n");
    await react("✅");
    return reply(`📰 *News results*\n\n${items || "No articles found."}`);
  } catch (error) {
    console.error("NewsAPI error:", error.message);
    return reply("News service is temporarily unavailable or its daily limit was reached.");
  }
});

// .country Kenya — REST Countries legacy public endpoint.
gmd({ pattern: "country", aliases: ["countryinfo", "countryapi"], react: "🌐", category: "api", description: "Get country information" }, async (from, Guru, ctx) => {
  const { q, reply, react } = ctx;
  if (!q?.trim()) return reply("Usage: .country <country name or code>");
  try {
    const data = await getJson(`https://restcountries.com/v3.1/name/${encodeURIComponent(q.trim())}`);
    const c = data?.[0];
    if (!c) return reply("Country not found.");
    await react("✅");
    return reply(`🌐 *${c.name?.common || q}*\n\nCapital: ${c.capital?.[0] || "-"}\nRegion: ${c.region || "-"}\nPopulation: ${(c.population || 0).toLocaleString()}\nCurrencies: ${Object.keys(c.currencies || {}).join(", ") || "-"}\nLanguages: ${Object.values(c.languages || {}).join(", ") || "-"}\nFlag: ${c.flags?.png || "-"}`);
  } catch (error) {
    console.error("REST Countries error:", error.message);
    return reply("Country service is unavailable. If the provider requires a key, add REST_COUNTRIES_API_KEY.");
  }
});

// .geocode Nairobi — Nominatim, limited to one request per second.
gmd({ pattern: "geocode", aliases: ["locate", "placeinfo"], react: "📍", category: "api", description: "Find coordinates for a place" }, async (from, Guru, ctx) => {
  const { q, reply, react } = ctx;
  if (!q?.trim()) return reply("Usage: .geocode <place>");
  try {
    const places = await nominatimSearch(q.trim());
    if (!places?.length) return reply("No place found.");
    const lines = places.map((p, i) => `${i + 1}. ${clean(p.display_name, 220)}\n   ${p.lat}, ${p.lon}`).join("\n\n");
    await react("✅");
    return reply(`📍 *Location results*\n\n${lines}\n\nMap data © OpenStreetMap contributors`);
  } catch (error) {
    console.error("Nominatim error:", error.message);
    return reply("Location service is temporarily unavailable.");
  }
});

// .gchat What is a webhook? — Gemini Developer API.
gmd({ pattern: "gchat", aliases: ["geminiapi", "freeai"], react: "🤖", category: "api", description: "Ask Gemini using an optional API key" }, async (from, Guru, ctx) => {
  const { q, reply, react } = ctx;
  if (!env("GEMINI_API_KEY")) return reply(apiKeyMessage("Gemini", "GEMINI_API_KEY"));
  if (!q?.trim()) return reply("Usage: .gchat <question>");
  const model = env("GEMINI_MODEL") || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  try {
    const data = await postJson(url, { contents: [{ parts: [{ text: q.trim().slice(0, 8000) }] }] }, { params: { key: env("GEMINI_API_KEY") } });
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim();
    if (!text) return reply("Gemini returned no text.");
    await react("✅");
    return reply(clean(text, 3500));
  } catch (error) {
    console.error("Gemini API error:", error.response?.data || error.message);
    return reply("Gemini is temporarily unavailable or the API key/model is invalid.");
  }
});
