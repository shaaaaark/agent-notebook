import { Injectable, Logger } from '@nestjs/common';
import { LlmProvider } from '../../providers/llm.provider';
import { Document } from '@langchain/core/documents';

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private readonly memory: Document[] = [];

  constructor(private readonly llm: LlmProvider) {}

  async addDocuments(docs: Document[]) {
    this.memory.push(...docs);
    this.logger.log(`Added ${docs.length} docs (memory store)`);
  }

  private buildPrompt(question: string) {
    const context = this.memory.slice(-5).map((d) => d.pageContent).join('\n');
    return `You are a helpful agent. Use the following context if relevant.\n\nContext:\n${context}\n\nQuestion: ${question}`;
  }

  async ask(question: string) {
    const prompt = this.buildPrompt(question);
    try {
      const result = await this.llm.chat.invoke(prompt);
      return { answer: result.content };
    } catch (error) {
      const err = error as Error & {
        status?: number;
        response?: { status?: number; statusText?: string; data?: unknown };
      };
      this.logger.error('LLM request failed', err);
      return {
        error: {
          message: err.message,
          status: err.status ?? err.response?.status,
          detail: err.response?.data ?? null,
        },
      };
    }
  }

  async askStream(question: string, onToken: (chunk: string) => void) {
    const prompt = this.buildPrompt(question);
    return this.llm.streamChatCompletion(prompt, onToken);
  }
}
