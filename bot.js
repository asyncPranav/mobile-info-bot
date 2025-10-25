import TelegramBot from "node-telegram-bot-api";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

// Read tokens from environment variables
const TOKEN = process.env.TELEGRAM_TOKEN;
const API_KEY = process.env.MOBILE_API_KEY;
const API_BASE = process.env.MOBILE_API_BASE;
const SHOW_SENSITIVE = String(process.env.SHOW_SENSITIVE || "").toLowerCase() === "true";
const ACCESS_CODE = process.env.ACCESS_CODE;

if (!TOKEN || !API_KEY || !API_BASE || !ACCESS_CODE) {
  console.error("Missing required environment variables. Check TELEGRAM_TOKEN, MOBILE_API_KEY, MOBILE_API_BASE, ACCESS_CODE.");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });
console.log("✅ Bot started. SHOW_SENSITIVE =", SHOW_SENSITIVE);

// In-memory store of authorized users
const authorizedUsers = {};

// In-memory lookup stats
const stats = { total: 0, perUser: {} };

// Rate limiting data
const lastRequest = {};
const RATE_LIMIT_MS = 10000; // 10 seconds

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
    `👋 Hello ${msg.chat.first_name || ""}!\n\nWelcome to the **Mobile Info Bot** 🔍\n\nTo begin, please enter your **access code**.`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "📌 **How to use:**\n1. Send your access code to unlock the bot.\n2. Once authorized, send a mobile number (digits only) to fetch details like Name, Operator, Address, and more.\n\n🔒 Sensitive fields are masked by default.",
    { parse_mode: "Markdown" }
  );
});

// /stats command
bot.onText(/\/stats/, (msg) => {
  const chatId = msg.chat.id;
  if (!authorizedUsers[chatId]) {
    bot.sendMessage(chatId, "🔒 Access denied. Please enter your access code first.");
    return;
  }

  const totalAuthorized = Object.keys(authorizedUsers).length;
  const userQueries = stats.perUser[chatId] || 0;
  const totalLookups = stats.total;

  bot.sendMessage(
    chatId,
    `📊 *Bot Stats*\n` +
    `👥 Total authorized users: ${totalAuthorized}\n` +
    `📈 Your queries: ${userQueries}\n` +
    `🌐 Total lookups: ${totalLookups}`,
    { parse_mode: "Markdown" }
  );
});

/* Main handler */
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = String(msg.text || "").trim();

  if (!text) return;
  if (text.startsWith("/")) return; // commands handled separately

  // Authorization
  if (!authorizedUsers[chatId]) {
    if (text === ACCESS_CODE) {
      authorizedUsers[chatId] = true;
      bot.sendMessage(chatId,
        "✅ **Access Granted!**\n\nYou can now use the Mobile Info Bot. Send a mobile number (digits only) to fetch info.",
        { parse_mode: "Markdown" }
      );
    } else {
      bot.sendMessage(chatId,
        "🔒 **Access Restricted**\nPlease enter your access code to use this bot.",
        { parse_mode: "Markdown" }
      );
    }
    return;
  }

  // Rate limiting
  const now = Date.now();
  if (lastRequest[chatId] && now - lastRequest[chatId] < RATE_LIMIT_MS) {
    const wait = Math.ceil((RATE_LIMIT_MS - (now - lastRequest[chatId])) / 1000);
    bot.sendMessage(chatId, `⏱ Please wait ${wait}s before sending another request.`);
    return;
  }
  lastRequest[chatId] = now;

  // Validate mobile number
  if (!/^\d{6,15}$/.test(text)) {
    bot.sendMessage(chatId,
      "⚠️ Please send a valid mobile number (digits only). Example: `9876543210`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  try {
    await bot.sendMessage(chatId, "🔍 Fetching info...");

    // API call
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
      "📱 **Mobile Info**",
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
      : "🔒 Sensitive fields are masked. To enable full output (with consent), set SHOW_SENSITIVE=true in env."
    );

    // Update stats
    stats.total++;
    stats.perUser[chatId] = (stats.perUser[chatId] || 0) + 1;

    await bot.sendMessage(chatId, replyLines.join("\n"), { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Error:", err);
    bot.sendMessage(chatId, `❌ Failed to fetch/process data: ${err.message}`);
  }
});
