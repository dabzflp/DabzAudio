export function getAIProvider() {
  const provider = (process.env.LLM_PROVIDER || (process.env.NODE_ENV === "production" ? "groq" : "ollama")).trim().toLowerCase();
  if (provider !== "groq" && (provider !== "ollama" || process.env.NODE_ENV === "production")) {
    throw Object.assign(new Error(`Unsupported LLM_PROVIDER: ${provider}. Use Groq in production or Ollama locally.`), { status: 503 });
  }
  return provider;
}
