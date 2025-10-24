import TelegramBot from "node-telegram-bot-api";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

// Read tokens from environment variables
const TOKEN = process.env.TELEGRAM_TOKEN;
const API_KEY = process.env.MOBILE_API_KEY;

if (!TOKEN || !API_KEY) {
  console.error("Missing TELEGRAM_TOKEN or MOBILE_API_KEY in environment.");
  process.exit(1);
}

const SHOW_SENSITIVE = String(process.env.SHOW_SENSITIVE || "").toLowerCase() === "true";

// Upstream mobile info API (with key secured in environment)
const API_BASE = process.env.MOBILE_API_BASE;

if (!API_BASE) {
  console.error("Missing MOBILE_API_BASE in environment.");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });
console.log("✅ Bot started. SHOW_SENSITIVE =", SHOW_SENSITIVE);

/* Helpers */
function maskString(s, keepLast = 4) {
  if (!s) return "N/A";
  const str = String(s);
  if (str.length <= keepLast) return "*".repeat(str.length);
  return "*".repeat(str.length - keepLast) + str.slice(-keepLast);
}

function maskName(name) {
  if (!name) return "N/A";
  const parts = String(name).trim().split(/\s+/);
  if (parts.length >= 2) {
    return parts.map(p => (p[0] ? p[0].toUpperCase() + "." : "")).join(" ");
  }
  const p = parts[0];
  return p[0].toUpperCase() + "." + "*".repeat(Math.max(0, p.length - 1));
}

function safeLine(label, value) {
  return `${label}: ${value ?? "N/A"}`;
}

/* Bot commands */
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `👋 Hello ${msg.chat.first_name || ""}!\nSend a mobile number (digits only) to lookup info.\n\nNote: Sensitive fields are masked by default. To enable full output locally (only if you have lawful consent), set SHOW_SENSITIVE=true in your environment.`
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "Send a mobile number like `9876543210`. The bot will return Number, Operator, and additional fields returned by the API (sensitive fields are masked by default).",
    { parse_mode: "Markdown" }
  );
});

/* Main handler */
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = String(msg.text || "").trim();

  if (!text || text.startsWith("/")) return;
  if (!/^\d{6,15}$/.test(text)) {
    bot.sendMessage(chatId, "⚠️ Please send a valid mobile number (digits only). Example: `9876543210`", { parse_mode: "Markdown" });
    return;
  }

  try {
    await bot.sendMessage(chatId, "🔍 Fetching info...");

    // API call with key from environment
    const url = `${API_BASE}${encodeURIComponent(text)}&key=${API_KEY}`;
    const res = await fetch(url, { timeout: 10000 });

    if (!res.ok) {
      bot.sendMessage(chatId, `❌ Upstream API error: HTTP ${res.status}`);
      return;
    }

    const apiJson = await res.json();
    const item = apiJson.data && apiJson.data.length > 0 ? apiJson.data[0] : null;

    if (!item) {
      bot.sendMessage(chatId, "❌ No data found for this number.");
      return;
    }

    // Map API fields
    const number = item.mobile ?? text;
    const operator = item.circle ?? "N/A";
    const name = SHOW_SENSITIVE ? (item.name ?? "N/A") : (item.name ? maskName(item.name) : "N/A");
    const father = SHOW_SENSITIVE ? (item.fname ?? "N/A") : (item.fname ? maskName(item.fname) : "N/A");
    const address = SHOW_SENSITIVE ? (item.address ?? "N/A") : (item.address ? maskString(item.address, 6) : "N/A");
    const govid = SHOW_SENSITIVE ? (item.id ?? "N/A") : (item.id ? maskString(item.id, 4) : "N/A");
    const altNum = SHOW_SENSITIVE ? (item.alt ?? "N/A") : (item.alt ? maskString(item.alt, 4) : "N/A");

    const replyLines = [
      "📱 Mobile Info",
      "────────────────────",
      safeLine("Number", number),
      safeLine("Name", name),
      safeLine("Operator", operator),
      safeLine("Father", father),
      safeLine("Address", address),
      safeLine("Gov ID", govid),
      safeLine("Alternate number", altNum),
      ""
    ];

    replyLines.push(SHOW_SENSITIVE
      ? "⚠️ Sensitive output is ENABLED. Make sure you have lawful consent."
      : "🔒 Sensitive fields are masked. To enable full output (only if you have consent), set SHOW_SENSITIVE=true in env."
    );

    await bot.sendMessage(chatId, replyLines.join("\n"));
  } catch (err) {
    console.error("Error:", err);
    bot.sendMessage(chatId, `❌ Failed to fetch/process data: ${err.message}`);
  }
});
