// Server-side singleton for the DeepSeek API. DeepSeek is OpenAI-compatible,
// so we reuse the official `openai` SDK pointed at their base URL.
import OpenAI from "openai";

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  // Don't crash at import time in the browser bundle, but make it loud
  // in server logs.
  console.warn(
    "[deepseek] DEEPSEEK_API_KEY is not set — chat requests will fail."
  );
}

export const deepseek = new OpenAI({
  apiKey: apiKey ?? "missing-key",
  baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
});

export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
export const USER_ID = process.env.USER_ID ?? "local-user";
