import { config } from "../config.js";
import type { NormalizedEmail } from "../providers/types.js";
import { fallbackExtract } from "./fallback.js";
import type { Selectivity } from "./importance.js";
import {
  buildExtractionSystemPrompt,
  buildExtractionUserPrompt,
} from "./prompt.js";
import {
  type ExtractionResult,
  validateExtractionResult,
} from "./schema.js";

function emailForModel(email: NormalizedEmail) {
  // Intentionally omit long bodies beyond a bound for privacy/token control
  return {
    provider: email.provider,
    messageId: email.messageId,
    threadId: email.threadId,
    subject: email.subject,
    from: email.from,
    to: email.to,
    cc: email.cc,
    sentAt: email.sentAt,
    bodyText: email.bodyText.slice(0, 6000),
    links: email.links.slice(0, 20),
    attachments: email.attachments,
  };
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Model response was not valid JSON");
  }
}

async function geminiExtract(
  email: NormalizedEmail,
  selectivity: Selectivity,
): Promise<ExtractionResult> {
  const system = buildExtractionSystemPrompt(selectivity);
  const prompt = `${system}

${buildExtractionUserPrompt(JSON.stringify(emailForModel(email), null, 2))}

Return only valid JSON.`;

  const url = `${config.gemini.baseUrl}/models/${config.gemini.model}:generateContent?key=${encodeURIComponent(config.gemini.apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini extraction failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const content = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!content) {
    throw new Error("Gemini returned empty content");
  }
  return validateExtractionResult(extractJsonObject(content));
}

async function openaiCompatibleExtract(
  email: NormalizedEmail,
  selectivity: Selectivity,
): Promise<ExtractionResult> {
  const system = buildExtractionSystemPrompt(selectivity);
  const payload = {
    model: config.openai.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: buildExtractionUserPrompt(JSON.stringify(emailForModel(email), null, 2)),
      },
    ],
  };

  const res = await fetch(`${config.openai.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openai.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM extraction failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty content");
  }
  return validateExtractionResult(extractJsonObject(content));
}

async function llmExtract(
  email: NormalizedEmail,
  selectivity: Selectivity,
): Promise<ExtractionResult> {
  if (config.gemini.apiKey) {
    return geminiExtract(email, selectivity);
  }
  return openaiCompatibleExtract(email, selectivity);
}

export async function extractTasks(
  email: NormalizedEmail,
  selectivity: Selectivity = "balanced",
): Promise<ExtractionResult> {
  if (!config.gemini.apiKey && !config.openai.apiKey) {
    return fallbackExtract(email);
  }
  try {
    return await llmExtract(email, selectivity);
  } catch (err) {
    console.warn("LLM extraction failed; using fallback parser", err);
    return fallbackExtract(email);
  }
}
