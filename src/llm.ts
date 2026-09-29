export class HelperLLM {
  private apiKey: string;
  private model: string;

  constructor(model = "deepseek/deepseek-v4.1-flash") {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) {
      throw new Error("missing openrouter_api_key in environment");
    }
    this.apiKey = key;
    this.model = model;
  }

  private async call(prompt: string): Promise<string> {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: 600,
        }),
      },
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`helper call failed: ${err}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    if (!content) {
      console.log(
        "warning: empty response from helper model. raw data:",
        JSON.stringify(data),
      );
    }

    return content.trim();
  }

  async getSearchQuery(
    goal: string,
    fieldDescription: string,
  ): Promise<string> {
    const prompt = `user goal: "${goal}". target field: "${fieldDescription}". what exact short search term should be typed into this input box? return only the query string in, nothing else.`;
    const res = await this.call(prompt);

    if (res) {
      return res.replace(/["'`]/g, "").trim();
    }

    return goal
      .replace(
        /^(find|search for|look for|what is|who is|where is|the|a)\s+/gi,
        "",
      )
      .trim();
  }

  async extractAnswer(goal: string, pageText: string): Promise<string> {
    const prompt = `user question: "${goal}". based only on the following page text, provide a concise direct answer.\n\npage text:\n${pageText.slice(0, 3000)}`;
    const answer = await this.call(prompt);
    return answer || "answer could not be extracted from the text.";
  }
}
