import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';

export type ChatCompletionResult = {
  content: string;
  promptTokens: number;
  completionTokens: number;
};

@Injectable()
export class LlmProvider {
  public readonly chat: ChatOpenAI;
  public readonly embeddings: OpenAIEmbeddings;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(private readonly config: ConfigService) {
    const baseUrl = this.config.get<string>('openai.baseUrl') ?? '';
    const apiKey = this.config.get<string>('openai.apiKey') ?? '';
    const model = this.config.get<string>('openai.model') ?? '';
    const embeddingBaseUrl =
      this.config.get<string>('openai.embeddingBaseUrl') ?? baseUrl;
    const embeddingApiKey =
      this.config.get<string>('openai.embeddingApiKey') ?? apiKey;
    const embeddingModel = this.config.get<string>('openai.embeddingModel') ?? '';
    const maxTokens = this.config.get<number>('openai.maxTokens') ?? 1024;
    const temperature = this.config.get<number>('openai.temperature') ?? 0;

    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.model = model;
    this.maxTokens = maxTokens;
    this.temperature = temperature;

    this.chat = new ChatOpenAI({
      model,
      temperature,
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
      apiKey: embeddingApiKey,
      configuration: {
        baseURL: embeddingBaseUrl,
        defaultHeaders: {
          'User-Agent': 'curl/8.5.0',
        },
      },
    });
  }

  async streamChatCompletion(
    prompt: string,
    onToken: (chunk: string) => void,
    options?: { signal?: AbortSignal },
  ): Promise<{ content: string }> {
    const url = `${this.baseUrl}/chat/completions`;
    const payload = {
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: this.maxTokens,
      temperature: this.temperature,
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
      signal: options?.signal,
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
    let content = '';

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
          return { content };
        }
        try {
          const json = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
          };
          const delta =
            json.choices?.[0]?.delta?.content ??
            json.choices?.[0]?.message?.content ??
            '';
          if (delta) {
            content += delta;
            onToken(delta);
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }

    return { content };
  }

  async complete(
    prompt: string,
    options?: { signal?: AbortSignal },
  ): Promise<ChatCompletionResult> {
    const url = `${this.baseUrl}/chat/completions`;
    const payload = {
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      stream: false,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'User-Agent': 'curl/8.5.0',
      },
      body: JSON.stringify(payload),
      signal: options?.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`LLM request failed: ${res.status}`) as Error & {
        status?: number;
        detail?: string;
      };
      err.status = res.status;
      err.detail = text;
      throw err;
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    return {
      content: json.choices?.[0]?.message?.content ?? '',
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
    };
  }
}
