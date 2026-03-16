import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';

@Injectable()
export class LlmProvider {
  public readonly chat: ChatOpenAI;
  public readonly embeddings: OpenAIEmbeddings;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    const baseUrl = this.config.get<string>('openai.baseUrl') ?? '';
    const apiKey = this.config.get<string>('openai.apiKey') ?? '';
    const model = this.config.get<string>('openai.model') ?? '';
    const embeddingModel = this.config.get<string>('openai.embeddingModel') ?? '';

    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.model = model;

    this.chat = new ChatOpenAI({
      model,
      apiKey,
      configuration: {
        baseURL: baseUrl,
        defaultHeaders: {
          'User-Agent': 'curl/8.5.0',
        },
      },
    });

    this.embeddings = new OpenAIEmbeddings({
      model: embeddingModel,
      apiKey,
      configuration: {
        baseURL: baseUrl,
        defaultHeaders: {
          'User-Agent': 'curl/8.5.0',
        },
      },
    });
  }

  async streamChatCompletion(
    prompt: string,
    onToken: (chunk: string) => void,
  ) {
    const url = `${this.baseUrl}/chat/completions`;
    const payload = {
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 512,
      stream: true,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'User-Agent': 'curl/8.5.0',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok || !res.body) {
      const text = await res.text();
      const err = new Error(`LLM request failed: ${res.status}`) as Error & {
        status?: number;
        detail?: string;
      };
      err.status = res.status;
      err.detail = text;
      throw err;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.replace(/^data:\s*/, '');
        if (data === '[DONE]') {
          return;
        }
        try {
          const json = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
          };
          const delta =
            json.choices?.[0]?.delta?.content ??
            json.choices?.[0]?.message?.content ??
            '';
          if (delta) onToken(delta);
        } catch {
          // ignore malformed chunks
        }
      }
    }
  }
}
