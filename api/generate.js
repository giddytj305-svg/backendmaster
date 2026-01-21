import fs from "fs";
import path from "path";
import axios from "axios";

// ✅ Memory folder (works on Vercel)
const MEMORY_DIR = "/tmp/memory";

// Create directory if it doesn't exist
try {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
    console.log(`✅ Created memory directory: ${MEMORY_DIR}`);
  }
} catch (err) {
  console.error("❌ Failed to create memory directory:", err);
}

// 🧠 Load user memory
function loadMemory(userId) {
  const filePath = path.join(MEMORY_DIR, `memory_${userId}.json`);
  console.log(`📂 Loading memory from: ${filePath}`);
  
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf-8");
      console.log(`✅ Memory loaded for user: ${userId}`);
      return JSON.parse(data);
    }
  } catch (err) {
    console.error(`❌ Failed to load memory for ${userId}:`, err.message);
  }

  console.log(`🆕 Creating new memory for user: ${userId}`);
  return {
    userId,
    lastProject: null,
    lastTask: null,
    conversation: [
      {
        role: "system",
        content: `
You are **MaxMovies AI** — an expressive, helpful, brilliant film-focused digital assistant 🤖🎬.

🔥 BACKSTORY:
• You were created by Max — a 21-year-old full-stack developer from Kenya 🇰🇪.
• Your core specialty is **movies, TV series, streaming content, characters, plots, recommendations, trivia**.

🎬 ENTERTAINMENT INTELLIGENCE:
• Provide film/series recommendations, summaries, analysis, comparisons, lore, viewing order guides, watchlists, and streaming suggestions.
• Explain genres, tropes, acting, cinematography, scoring, directing styles, or franchise histories.
• Always stay spoiler-safe unless the user asks for spoilers.

💡 SPECIAL INSTRUCTION:
• MaxMovies AI is integrated into MaxMovies platform to help users find and choose their favorite TV shows and movies.
• Only mention this integration if the user explicitly asks about your platform, capabilities, or creator.
        `,
      },
    ],
  };
}

// 💾 Save user memory
function saveMemory(userId, memory) {
  const filePath = path.join(MEMORY_DIR, `memory_${userId}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(memory, null, 2), "utf-8");
    console.log(`💾 Memory saved for user: ${userId}`);
  } catch (err) {
    console.error(`❌ Failed to save memory for ${userId}:`, err.message);
  }
}

// 🧠 Detect language
function detectLanguage(text) {
  if (!text || typeof text !== 'string') return "english";
  
  const lower = text.toLowerCase();
  const swahiliWords = ["habari", "sasa", "niko", "kwani", "basi", "ndio", "karibu", "asante", "mambo", "poa", "sawa"];
  const shengWords = ["bro", "maze", "manze", "noma", "fiti", "safi", "buda", "msee", "mwana", "poa", "vibe"];

  const swCount = swahiliWords.filter(w => lower.includes(w)).length;
  const shCount = shengWords.filter(w => lower.includes(w)).length;

  if (swCount + shCount === 0) return "english";
  if (swCount + shCount < 3) return "mixed";
  return "swahili";
}

// 🚀 Main Serverless Function
export default async function handler(req, res) {
  console.log("\n" + "=".repeat(50));
  console.log("🚀 MaxMovies AI API Request Received");
  console.log("=".repeat(50));
  
  // CORS headers
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") return res.status(200).json({
    status: "online",
    service: "MaxMovies AI Assistant",
    version: "1.0.0",
    endpoints: {
      generate: {
        method: "POST",
        description: "Chat with the AI",
        body: { prompt: "string (required)", userId: "string (optional)", project: "string (optional)" }
      }
    }
  });

  if (req.method !== "POST") return res.status(405).json({ error: `Method ${req.method} not allowed. Use POST or GET.`, allowed: ['POST', 'GET', 'OPTIONS'] });

  try {
    // Parse body
    let body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { prompt, project, userId = "default" } = body;

    if (!prompt || prompt.trim() === '') return res.status(400).json({ error: "Missing or empty prompt parameter." });

    // Load memory
    let memory = loadMemory(userId);
    if (project) memory.lastProject = project;
    memory.lastTask = prompt;
    memory.conversation.push({ role: "user", content: prompt });

    // Language detection
    const lang = detectLanguage(prompt);
    let languageInstruction = lang === "swahili" 
      ? "Respond fully in Swahili or Sheng naturally depending on tone."
      : lang === "mixed" 
        ? "Respond bilingually — mostly English, with natural Swahili/Sheng flavor."
        : "Respond in English, friendly Kenyan developer tone.";

    // Add instruction to system message
    const messages = [...memory.conversation];
    if (messages[0]?.role === "system") messages[0].content += `\n\n${languageInstruction}`;

    // Hugging Face API key
    if (!process.env.HF_TOKEN) return res.status(500).json({ error: "Server configuration error", message: "HF_TOKEN is not set" });

    console.log(`📡 Calling Hugging Face API with ${messages.length} messages...`);

    // Hugging Face Chat API call
    const hfResponse = await axios.post(
      "https://api-inference.huggingface.co/v1/chat/completions",
      { model: "meta-llama/Llama-3.2-1B-Instruct", messages },
      { headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` }, timeout: 30000 }
    ).catch(err => {
      const errMsg = err.response?.data?.error?.message || err.message;
      if (errMsg.toLowerCase().includes("insufficient quota")) {
        return res.status(402).json({ error: "Hugging Face API failed: Insufficient quota", message: "Please top up your HF account or use a different token." });
      }
      throw err;
    });

    const assistantReply = hfResponse.data?.choices?.[0]?.message?.content || "I couldn't generate a response. Please try again.";

    const cleanText = assistantReply.replace(/as an ai|language model/gi, "");
    memory.conversation.push({ role: "assistant", content: cleanText });

    // Limit conversation to last 20 messages
    if (memory.conversation.length > 20) {
      const systemMessage = memory.conversation[0];
      memory.conversation = [systemMessage, ...memory.conversation.slice(-19)];
    }

    saveMemory(userId, memory);

    return res.status(200).json({ 
      reply: cleanText,
      memory: {
        lastProject: memory.lastProject,
        conversationLength: memory.conversation.length,
        userId
      }
    });

  } catch (error) {
    console.error("💥 ERROR:", error);
    return res.status(500).json({ error: "Server error", details: error.message });
  }
}
