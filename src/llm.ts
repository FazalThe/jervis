export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  timeoutMs?: number;
}

const DEFAULT_HELPER_MODEL = "deepseek/deepseek-v4.1-flash";

export class HelperLLM {
  private apiKey: string;
  private model: string;

  constructor(model = process.env.JERVIS_HELPER_MODEL || DEFAULT_HELPER_MODEL) {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) {
      throw new Error("missing openrouter_api_key in environment");
    }
    this.apiKey = key;
    this.model = model;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60000);

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: opts.model ?? this.model,
          messages,
          temperature: opts.temperature ?? 0.1,
          max_tokens: opts.maxTokens ?? 2048,
          reasoning: { exclude: true },
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`helper call failed: ${err}`);
      }

      const data: {
        choices?: Array<{ message?: { content?: string } }>;
      } = await response.json();
      const content = data.choices?.[0]?.message?.content || "";

      if (!content) {
        console.log("warning: empty response from helper model. raw data:", JSON.stringify(data));
      }

      return content.trim();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async call(prompt: string): Promise<string> {
    return this.chat([{ role: "user", content: prompt }]);
  }

  async getSearchQuery(goal: string, fieldDescription: string): Promise<string> {
    const prompt = `user goal: "${goal}". target input field: "${fieldDescription}". what exact short text should be typed into this field? reply with only the text, nothing else.`;
    const res = await this.call(prompt);
    const cleaned = firstLine(res, 80);

    if (cleaned) return cleaned;

    return goal
      .replace(/^(find|search for|look for|what is|who is|where is|the|a)\s+/gi, "")
      .trim()
      .slice(0, 80);
  }

  async chooseOption(question: string, options: Record<string, string>): Promise<string | null> {
    const labels = Object.keys(options);
    if (labels.length === 0) return null;

    const listing = labels.map((label) => `- ${label}: ${options[label]}`).join("\n");
    const prompt = `${question}\n\nchoose exactly one label from this list:\n${listing}\n\nreply with only the label, nothing else.`;
    const res = firstLine(await this.call(prompt), 120);

    const exact = labels.find((label) => label.toLowerCase() === res.toLowerCase());
    if (exact) return exact;
    const partial = labels.find((label) => res.toLowerCase().includes(label.toLowerCase()));
    return partial ?? null;
  }

  async extractAnswer(goal: string, pageText: string): Promise<string> {
    const prompt = `user question: "${goal}". based only on the following page text, provide a concise direct answer.\n\npage text:\n${pageText.slice(0, 6000)}`;
    const answer = await this.call(prompt);
    return answer || "answer could not be extracted from the text.";
  }
}

export function firstLine(raw: string, maxLength = 80): string {
  const line = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return "";
  return line
    .replace(/^[#*\-\s]+/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
