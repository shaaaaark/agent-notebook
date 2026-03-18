import * as fs from 'fs/promises';
import * as path from 'path';

type TraceRecord = {
  request_id: string;
  timestamp: string;
  policy_version?: string;
  replay_input?: {
    query: string;
    selected_chunk_ids: string[];
    retrieved_chunk_ids: string[];
    model: string;
  };
  final_status?: string;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.requestId) {
    throw new Error('usage: npx ts-node eval/replay.ts --request-id <id> [--host http://127.0.0.1:9527]');
  }

  const trace = await findTraceByRequestId(args.requestId);
  if (!trace) {
    throw new Error(`trace not found for request_id=${args.requestId}`);
  }

  const host = args.host ?? 'http://127.0.0.1:9527';
  const query = trace.replay_input?.query ?? '';
  if (!query) {
    throw new Error(`trace ${args.requestId} has no replay_input.query`);
  }

  const result = await askQuestion(host, query);
  const output = {
    request_id: trace.request_id,
    baseline: {
      timestamp: trace.timestamp,
      policy_version: trace.policy_version ?? 'unknown',
      final_status: trace.final_status ?? 'unknown',
      replay_input: trace.replay_input ?? null,
    },
    replay: {
      host,
      final_status: result.finalStatus,
      request_id: result.requestId,
      answer_preview: result.answer.slice(0, 300),
    },
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

function parseArgs(argv: string[]): { requestId?: string; host?: string } {
  const args: { requestId?: string; host?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];
    if (current === '--request-id' && next && !next.startsWith('--')) {
      args.requestId = next;
      i += 1;
      continue;
    }
    if (current === '--host' && next && !next.startsWith('--')) {
      args.host = next;
      i += 1;
    }
  }
  return args;
}

async function findTraceByRequestId(requestId: string): Promise<TraceRecord | null> {
  const traceDir = path.resolve(process.cwd(), 'logs', 'traces');
  const files = await collectJsonlFiles(traceDir);

  for (const filePath of files.sort().reverse()) {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').map((line) => line.trim()).filter(Boolean).reverse();
    for (const line of lines) {
      const parsed = JSON.parse(line) as TraceRecord;
      if (parsed.request_id === requestId) {
        return parsed;
      }
    }
  }

  return null;
}

async function collectJsonlFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsonlFiles(fullPath)));
    } else if (entry.isFile() && fullPath.endsWith('.jsonl')) {
      files.push(fullPath);
    }
  }

  return files;
}

async function askQuestion(host: string, question: string): Promise<{ answer: string; requestId: string; finalStatus: string }> {
  const res = await fetch(`${host}/rag/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new Error(`ask failed: ${res.status}${body ? ` - ${body.slice(0, 200)}` : ''}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let answer = '';
  let requestId = '';
  let finalStatus = 'error';
  let buffer = '';
  let currentEvent = 'message';
  let dataLines: string[] = [];

  const flushEvent = () => {
    if (!dataLines.length) {
      currentEvent = 'message';
      return;
    }

    const data = dataLines.join('\n').trim();
    if (currentEvent === 'message') {
      answer += data;
    } else if (currentEvent === 'done') {
      const parsed = JSON.parse(data) as { request_id?: string; final_status?: string };
      requestId = String(parsed.request_id ?? '').trim();
      finalStatus = String(parsed.final_status ?? 'error').trim() || 'error';
    }

    currentEvent = 'message';
    dataLines = [];
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, '');
      if (!line) {
        flushEvent();
        continue;
      }
      if (line.startsWith('event:')) {
        flushEvent();
        currentEvent = line.slice(6).trim() || 'message';
        continue;
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
  }

  if (dataLines.length) flushEvent();
  return { answer, requestId, finalStatus };
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
