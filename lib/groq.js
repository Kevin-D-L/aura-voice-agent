// Minimal client for Groq's OpenAI-compatible Chat Completions API (free tier).
// No SDK needed - just fetch.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

export async function groqChat(body) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set");

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, ...body }),
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Groq API ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}