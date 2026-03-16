import * as fs from 'fs/promises';
import * as path from 'path';

type EvalCase = {
  case_id: string;
  category: string;
  question: string;
  expected_points: string[];
  must_cite: boolean;
  gold_sources: string[];
  constraints: string[];
};

type TraceChunkRecord = {
  chunk_id: string;
  source: string;
  score: number;
};

type RequestTrace = {
  request_id: string;
  timestamp: string;
  query_raw: string;
  retrieve_topK: number;
  retrieved_chunks: TraceChunkRecord[];
  retrieve_latency_ms: number;
  selected_chunks: string[];
  selected_sources: string[];
  skipped_reasons: Record<string, number>;
  token_used: number;
  truncated: boolean;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  generate_latency_ms: number;
  answer_hash: string;
  citations_parsed: string[];
  final_status: string;
  user_feedback?: 1 | -1;
};

type AskResult = {
  answer: string;
  requestId: string;
  finalStatus: string;
  sources: Array<{ source: string }>;
  errorMessage?: string;
};

type CaseRunRecord = {
  case_id: string;
  category: string;
  question: string;
  request_id: string;
  final_status: string;
  gold_sources: string[];
  retrieved_sources: string[];
  selected_sources: string[];
  recall_hit: boolean;
  context_hit: boolean;
  citation_hit: boolean;
  answer: string;
};

type HarnessMetrics = {
  run_id: string;
  host: string;
  generated_at: string;
  total_cases: number;
  recall_at_k: number;
  context_hit: number;
  citation_presence_rate: number;
  clarify_rate: number;
  abstain_rate: number;
  error_rate: number;
  status_counts: Record<string, number>;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const host = args.host ?? `http://localhost:${process.env.PORT ?? '3000'}`;
  const runId = args.runId ?? new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const casesDir = await resolveCasesDir(args.cases);
  const runDir = path.resolve(process.cwd(), 'eval', 'runs', runId);

  await fs.mkdir(runDir, { recursive: true });

  const cases = await loadCases(casesDir);
  const runRecords: CaseRunRecord[] = [];

  for (const evalCase of cases) {
    let askResult: AskResult;
    try {
      askResult = await askQuestion(host, evalCase.question);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`[${evalCase.case_id}] ERROR: ${msg}\n`);
      runRecords.push({
        case_id: evalCase.case_id,
        category: evalCase.category,
        question: evalCase.question,
        request_id: '',
        final_status: 'error',
        gold_sources: evalCase.gold_sources,
        retrieved_sources: [],
        selected_sources: [],
        recall_hit: false,
        context_hit: false,
        citation_hit: false,
        answer: '',
      });
      continue;
    }

    let retrievedSources: string[] = [];
    let selectedSources: string[] = [];

    if (askResult.requestId) {
      try {
        const trace = await fetchTrace(host, askResult.requestId);
        retrievedSources = Array.from(
          new Set(trace.retrieved_chunks?.map((item) => item.source) ?? []),
        );
        selectedSources = Array.from(
          new Set(trace.selected_sources ?? []),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stdout.write(
          `[${evalCase.case_id}] trace fetch failed: ${msg}\n`,
        );
      }
    } else if (askResult.errorMessage) {
      process.stdout.write(
        `[${evalCase.case_id}] ${askResult.finalStatus} (no request_id): ${askResult.errorMessage}\n`,
      );
    }

    const recallHit = evalCase.gold_sources.some((source) =>
      retrievedSources.includes(source),
    );
    const contextHit = evalCase.gold_sources.some((source) =>
      selectedSources.includes(source),
    );
    const citationHit = !evalCase.must_cite || /\[E\d+\]/.test(askResult.answer);

    runRecords.push({
      case_id: evalCase.case_id,
      category: evalCase.category,
      question: evalCase.question,
      request_id: askResult.requestId,
      final_status: askResult.finalStatus,
      gold_sources: evalCase.gold_sources,
      retrieved_sources: retrievedSources,
      selected_sources: selectedSources,
      recall_hit: recallHit,
      context_hit: contextHit,
      citation_hit: citationHit,
      answer: askResult.answer,
    });

    process.stdout.write(
      `[${evalCase.case_id}] ${askResult.finalStatus} | recall=${recallHit ? 'Y' : 'N'} | context=${contextHit ? 'Y' : 'N'}\n`,
    );
  }

  const metrics = buildMetrics(runId, host, runRecords);
  await fs.writeFile(
    path.join(runDir, 'trace.jsonl'),
    runRecords.map((record) => JSON.stringify(record)).join('\n') + '\n',
    'utf-8',
  );
  await fs.writeFile(
    path.join(runDir, 'metrics.json'),
    `${JSON.stringify(metrics, null, 2)}\n`,
    'utf-8',
  );
  await fs.writeFile(
    path.join(runDir, 'report.md'),
    buildReport(runId, casesDir, metrics, runRecords),
    'utf-8',
  );

  process.stdout.write(`\nRun completed: eval/runs/${runId}\n`);
}

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current.startsWith('--') && next && !next.startsWith('--')) {
      args[current.slice(2)] = next;
      index += 1;
    }
  }

  return {
    cases: args.cases,
    host: args.host,
    runId: args['run-id'],
  };
}

async function resolveCasesDir(input?: string): Promise<string> {
  const candidates = input
    ? [
        path.resolve(process.cwd(), input),
        path.resolve(process.cwd(), 'eval', input),
      ]
    : [path.resolve(process.cwd(), 'eval', 'cases')];

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) {
        return candidate;
      }
    } catch {
      // continue
    }
  }

  throw new Error(`Cases directory not found: ${input ?? 'eval/cases'}`);
}

async function loadCases(casesDir: string): Promise<EvalCase[]> {
  const entries = (await fs.readdir(casesDir))
    .filter((entry) => entry.endsWith('.json'))
    .sort();

  const groups = await Promise.all(
    entries.map(async (entry) => {
      const filePath = path.join(casesDir, entry);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as EvalCase[];
    }),
  );

  return groups.flat();
}

async function askQuestion(host: string, question: string): Promise<AskResult> {
  const res = await fetch(`${host}/rag/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
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
  let sources: Array<{ source: string }> = [];
  let errorMessage = '';
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
      try {
        const parsed = JSON.parse(data) as {
          request_id?: string;
          final_status?: string;
          sources?: Array<{ source: string }>;
        };
        requestId = String(parsed?.request_id ?? '').trim();
        finalStatus = String(parsed?.final_status ?? 'error').trim() || 'error';
        sources = Array.isArray(parsed?.sources) ? parsed.sources : [];
      } catch {
        errorMessage = `done payload parse failed: ${data.slice(0, 100)}`;
      }
    } else if (currentEvent === 'error') {
      try {
        const parsed = JSON.parse(data) as { message?: string };
        errorMessage = (parsed?.message ?? data) || 'SSE error event';
      } catch {
        errorMessage = data || 'SSE error event';
      }
      finalStatus = 'error';
    }

    currentEvent = 'message';
    dataLines = [];
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

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

  if (dataLines.length) {
    flushEvent();
  }

  return {
    answer,
    requestId,
    finalStatus,
    sources,
    ...(errorMessage && { errorMessage }),
  };
}

async function fetchTrace(host: string, requestId: string): Promise<RequestTrace> {
  const res = await fetch(`${host}/rag/trace/${requestId}`);
  if (!res.ok) {
    throw new Error(`trace fetch failed: ${res.status}`);
  }
  return (await res.json()) as RequestTrace;
}

function buildMetrics(
  runId: string,
  host: string,
  records: CaseRunRecord[],
): HarnessMetrics {
  const totalCases = records.length || 1;
  const statusCounts = records.reduce<Record<string, number>>((acc, record) => {
    acc[record.final_status] = (acc[record.final_status] ?? 0) + 1;
    return acc;
  }, {});

  return {
    run_id: runId,
    host,
    generated_at: new Date().toISOString(),
    total_cases: records.length,
    recall_at_k: roundRate(records.filter((item) => item.recall_hit).length / totalCases),
    context_hit: roundRate(records.filter((item) => item.context_hit).length / totalCases),
    citation_presence_rate: roundRate(
      records.filter((item) => item.citation_hit).length / totalCases,
    ),
    clarify_rate: roundRate((statusCounts.clarify ?? 0) / totalCases),
    abstain_rate: roundRate((statusCounts.abstain ?? 0) / totalCases),
    error_rate: roundRate((statusCounts.error ?? 0) / totalCases),
    status_counts: statusCounts,
  };
}

function roundRate(value: number): number {
  return Number(value.toFixed(4));
}

function buildReport(
  runId: string,
  casesDir: string,
  metrics: HarnessMetrics,
  records: CaseRunRecord[],
): string {
  const failures = records.filter((record) => !record.recall_hit || !record.context_hit);
  const lines = [
    `# Eval Report - ${runId}`,
    '',
    `- Cases dir: \`${casesDir}\``,
    `- Host: \`${metrics.host}\``,
    `- Generated at: \`${metrics.generated_at}\``,
    '',
    '## Summary',
    '',
    '| Metric | Value |',
    '|---|---:|',
    `| Recall@K | ${metrics.recall_at_k} |`,
    `| Context-hit | ${metrics.context_hit} |`,
    `| Citation presence | ${metrics.citation_presence_rate} |`,
    `| Clarify rate | ${metrics.clarify_rate} |`,
    `| Abstain rate | ${metrics.abstain_rate} |`,
    `| Error rate | ${metrics.error_rate} |`,
    '',
    '## Failure Cases',
    '',
  ];

  if (!failures.length) {
    lines.push('All cases passed Recall@K and Context-hit.');
  } else {
    lines.push('| Case | Status | Recall | Context | Gold Sources | Retrieved | Selected |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const record of failures) {
      lines.push(
        `| ${record.case_id} | ${record.final_status} | ${record.recall_hit ? 'Y' : 'N'} | ${record.context_hit ? 'Y' : 'N'} | ${record.gold_sources.join(', ')} | ${record.retrieved_sources.join(', ')} | ${record.selected_sources.join(', ')} |`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
