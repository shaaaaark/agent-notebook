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
  policy_version?: string;
  replay_input?: {
    query: string;
    selected_chunk_ids: string[];
    retrieved_chunk_ids: string[];
    model: string;
  };
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

type GateRule = {
  op: 'gte' | 'lte';
  value: number;
};

type GateConfig = {
  hard_gates: Record<string, GateRule>;
  soft_gates: Record<string, GateRule>;
};

type GateResult = {
  verdict: 'PASS' | 'MANUAL_REVIEW' | 'FAIL';
  hardFailures: string[];
  softFailures: string[];
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

type MetricDelta = {
  label: string;
  baseline: number;
  candidate: number;
  delta: number;
};

type CaseComparison = {
  case_id: string;
  baseline_status: string;
  candidate_status: string;
  baseline_recall: boolean;
  candidate_recall: boolean;
  baseline_context: boolean;
  candidate_context: boolean;
  baseline_citation: boolean;
  candidate_citation: boolean;
};

type HarnessArgs = {
  cases?: string;
  host?: string;
  runId?: string;
  compare?: [string, string];
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.compare) {
    const [baselineRunId, candidateRunId] = args.compare;
    await compareRuns(baselineRunId, candidateRunId);
    return;
  }

  await executeRun(args);
}

function parseArgs(argv: string[]): HarnessArgs {
  const args: HarnessArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === '--compare') {
      const baseline = argv[index + 1];
      const candidate = argv[index + 2];
      if (!baseline || !candidate || baseline.startsWith('--') || candidate.startsWith('--')) {
        throw new Error('usage: --compare <baseline_run_id> <candidate_run_id>');
      }
      args.compare = [baseline, candidate];
      index += 2;
      continue;
    }

    if (current.startsWith('--') && next && !next.startsWith('--')) {
      const key = current.slice(2);
      if (key === 'cases') args.cases = next;
      if (key === 'host') args.host = next;
      if (key === 'run-id') args.runId = next;
      index += 1;
    }
  }

  return args;
}

async function executeRun(args: HarnessArgs) {
  const host = args.host ?? `http://localhost:${process.env.PORT ?? '3000'}`;
  const runId =
    args.runId ?? new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
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
        selectedSources = Array.from(new Set(trace.selected_sources ?? []));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stdout.write(`[${evalCase.case_id}] trace fetch failed: ${msg}\n`);
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
  await writeJsonl(path.join(runDir, 'trace.jsonl'), runRecords);
  await writeJson(path.join(runDir, 'metrics.json'), metrics);
  await fs.writeFile(
    path.join(runDir, 'report.md'),
    buildRunReport(runId, casesDir, metrics, runRecords),
    'utf-8',
  );

  process.stdout.write(`\nRun completed: eval/runs/${runId}\n`);
}

async function compareRuns(baselineRunId: string, candidateRunId: string) {
  const baselineDir = await resolveRunDir(baselineRunId);
  const candidateDir = await resolveRunDir(candidateRunId);

  const baselineMetrics = await readJson<HarnessMetrics>(
    path.join(baselineDir, 'metrics.json'),
  );
  const candidateMetrics = await readJson<HarnessMetrics>(
    path.join(candidateDir, 'metrics.json'),
  );
  const baselineRecords = await readJsonl<CaseRunRecord>(
    path.join(baselineDir, 'trace.jsonl'),
  );
  const candidateRecords = await readJsonl<CaseRunRecord>(
    path.join(candidateDir, 'trace.jsonl'),
  );

  const metricDeltas = buildMetricDeltas(baselineMetrics, candidateMetrics);
  const comparison = compareCaseRuns(baselineRecords, candidateRecords);
  const gateConfig = await loadGateConfig();
  const gateResult = evaluateGates(candidateMetrics, gateConfig);
  const report = buildComparisonReport(
    baselineRunId,
    candidateRunId,
    metricDeltas,
    comparison.newFailures,
    comparison.fixedCases,
    comparison.statusChanges,
    comparison.missingCases,
    gateResult,
  );
  const reportPath = path.join(candidateDir, `compare_to_${baselineRunId}.md`);

  await fs.writeFile(reportPath, report, 'utf-8');

  process.stdout.write(`Compare completed: eval/runs/${candidateRunId}/compare_to_${baselineRunId}.md\n`);
  process.stdout.write(
    `Gate=${gateResult.verdict} | Regressions=${comparison.newFailures.length}, fixed=${comparison.fixedCases.length}, status_changed=${comparison.statusChanges.length}\n`,
  );
}

async function resolveCasesDir(input?: string): Promise<string> {
  const candidates = input
    ? [path.resolve(process.cwd(), input), path.resolve(process.cwd(), 'eval', input)]
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

async function resolveRunDir(runId: string): Promise<string> {
  const runDir = path.resolve(process.cwd(), 'eval', 'runs', runId);
  try {
    const stat = await fs.stat(runDir);
    if (!stat.isDirectory()) {
      throw new Error();
    }
    return runDir;
  } catch {
    throw new Error(`Run directory not found: eval/runs/${runId}`);
  }
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

function buildMetricDeltas(
  baseline: HarnessMetrics,
  candidate: HarnessMetrics,
): MetricDelta[] {
  return [
    { label: 'Recall@K', baseline: baseline.recall_at_k, candidate: candidate.recall_at_k, delta: roundDelta(candidate.recall_at_k - baseline.recall_at_k) },
    { label: 'Context-hit', baseline: baseline.context_hit, candidate: candidate.context_hit, delta: roundDelta(candidate.context_hit - baseline.context_hit) },
    {
      label: 'Citation presence',
      baseline: baseline.citation_presence_rate,
      candidate: candidate.citation_presence_rate,
      delta: roundDelta(candidate.citation_presence_rate - baseline.citation_presence_rate),
    },
    { label: 'Clarify rate', baseline: baseline.clarify_rate, candidate: candidate.clarify_rate, delta: roundDelta(candidate.clarify_rate - baseline.clarify_rate) },
    { label: 'Abstain rate', baseline: baseline.abstain_rate, candidate: candidate.abstain_rate, delta: roundDelta(candidate.abstain_rate - baseline.abstain_rate) },
    { label: 'Error rate', baseline: baseline.error_rate, candidate: candidate.error_rate, delta: roundDelta(candidate.error_rate - baseline.error_rate) },
  ];
}

function compareCaseRuns(
  baselineRecords: CaseRunRecord[],
  candidateRecords: CaseRunRecord[],
): {
  newFailures: CaseComparison[];
  fixedCases: CaseComparison[];
  statusChanges: CaseComparison[];
  missingCases: string[];
} {
  const baselineMap = new Map(baselineRecords.map((record) => [record.case_id, record]));
  const candidateMap = new Map(candidateRecords.map((record) => [record.case_id, record]));
  const caseIds = Array.from(
    new Set(baselineMapKeys(baselineMap).concat(baselineMapKeys(candidateMap))),
  ).sort();

  const newFailures: CaseComparison[] = [];
  const fixedCases: CaseComparison[] = [];
  const statusChanges: CaseComparison[] = [];
  const missingCases: string[] = [];

  for (const caseId of caseIds) {
    const baseline = baselineMap.get(caseId);
    const candidate = candidateMap.get(caseId);

    if (!baseline || !candidate) {
      missingCases.push(caseId);
      continue;
    }

    const comparison: CaseComparison = {
      case_id: caseId,
      baseline_status: baseline.final_status,
      candidate_status: candidate.final_status,
      baseline_recall: baseline.recall_hit,
      candidate_recall: candidate.recall_hit,
      baseline_context: baseline.context_hit,
      candidate_context: candidate.context_hit,
      baseline_citation: baseline.citation_hit,
      candidate_citation: candidate.citation_hit,
    };

    const baselineFailure = isFailure(baseline);
    const candidateFailure = isFailure(candidate);

    if (!baselineFailure && candidateFailure) {
      newFailures.push(comparison);
    }
    if (baselineFailure && !candidateFailure) {
      fixedCases.push(comparison);
    }
    if (baseline.final_status !== candidate.final_status) {
      statusChanges.push(comparison);
    }
  }

  return { newFailures, fixedCases, statusChanges, missingCases };
}

function buildRunReport(
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

function buildComparisonReport(
  baselineRunId: string,
  candidateRunId: string,
  metricDeltas: MetricDelta[],
  newFailures: CaseComparison[],
  fixedCases: CaseComparison[],
  statusChanges: CaseComparison[],
  missingCases: string[],
  gateResult: GateResult,
): string {
  const lines = [
    `# Eval Comparison - ${candidateRunId} vs ${baselineRunId}`,
    '',
    `- Baseline: \`${baselineRunId}\``,
    `- Candidate: \`${candidateRunId}\``,
    '',
    '## Gate Verdict',
    '',
    `- Verdict: **${gateResult.verdict}**`,
    `- Hard failures: ${gateResult.hardFailures.length ? gateResult.hardFailures.join(', ') : 'None'}`,
    `- Soft failures: ${gateResult.softFailures.length ? gateResult.softFailures.join(', ') : 'None'}`,
    '',
    '## Metric Deltas',
    '',
    '| Metric | Baseline | Candidate | Delta |',
    '|---|---:|---:|---:|',
  ];

  for (const row of metricDeltas) {
    lines.push(
      `| ${row.label} | ${row.baseline} | ${row.candidate} | ${formatSigned(row.delta)} |`,
    );
  }

  lines.push('', '## New Failures', '');
  appendComparisonTable(lines, newFailures, 'No new failures.');

  lines.push('', '## Fixed Cases', '');
  appendComparisonTable(lines, fixedCases, 'No fixed cases.');

  lines.push('', '## Status Changes', '');
  if (!statusChanges.length) {
    lines.push('No status changes.');
  } else {
    lines.push('| Case | Baseline Status | Candidate Status |');
    lines.push('|---|---|---|');
    for (const item of statusChanges) {
      lines.push(
        `| ${item.case_id} | ${item.baseline_status} | ${item.candidate_status} |`,
      );
    }
  }

  lines.push('', '## Missing Cases', '');
  if (!missingCases.length) {
    lines.push('No missing cases between runs.');
  } else {
    lines.push(missingCases.map((item) => `- ${item}`).join('\n'));
  }

  return `${lines.join('\n')}\n`;
}

function appendComparisonTable(
  lines: string[],
  cases: CaseComparison[],
  emptyMessage: string,
) {
  if (!cases.length) {
    lines.push(emptyMessage);
    return;
  }

  lines.push('| Case | Baseline Status | Candidate Status | Recall | Context | Citation |');
  lines.push('|---|---|---|---|---|---|');
  for (const item of cases) {
    lines.push(
      `| ${item.case_id} | ${item.baseline_status} | ${item.candidate_status} | ${toDiffMark(item.baseline_recall, item.candidate_recall)} | ${toDiffMark(item.baseline_context, item.candidate_context)} | ${toDiffMark(item.baseline_citation, item.candidate_citation)} |`,
    );
  }
}

async function loadGateConfig(): Promise<GateConfig> {
  const filePath = path.resolve(process.cwd(), 'eval', 'thresholds.yaml');
  const content = await fs.readFile(filePath, 'utf-8');
  return parseSimpleYaml(content) as GateConfig;
}

function evaluateGates(metrics: HarnessMetrics, config: GateConfig): GateResult {
  const metricMap = metrics as unknown as Record<string, number>;
  const hardFailures = Object.entries(config.hard_gates ?? {})
    .filter(([metric, rule]) => !passesRule(metricMap[metric], rule))
    .map(([metric]) => metric);
  const softFailures = Object.entries(config.soft_gates ?? {})
    .filter(([metric, rule]) => !passesRule(metricMap[metric], rule))
    .map(([metric]) => metric);

  return {
    verdict: hardFailures.length ? 'FAIL' : softFailures.length ? 'MANUAL_REVIEW' : 'PASS',
    hardFailures,
    softFailures,
  };
}

function passesRule(value: number | undefined, rule: GateRule): boolean {
  if (typeof value !== 'number' || Number.isNaN(value)) return false;
  if (rule.op === 'gte') return value >= rule.value;
  return value <= rule.value;
}

function parseSimpleYaml(input: string): Record<string, unknown> {
  const root: Record<string, any> = {};
  let section: string | null = null;
  let metric: string | null = null;

  for (const raw of input.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;

    const indent = raw.match(/^\s*/)?.[0].length ?? 0;
    const line = raw.trim();

    if (indent === 0 && line.endsWith(':')) {
      section = line.slice(0, -1);
      root[section] = {};
      metric = null;
      continue;
    }

    if (indent === 2 && line.endsWith(':') && section) {
      metric = line.slice(0, -1);
      (root[section] as Record<string, unknown>)[metric] = {};
      continue;
    }

    if (indent === 4 && section && metric) {
      const [key, rawValue] = line.split(':').map((item) => item.trim());
      const value = /^-?\d+(\.\d+)?$/.test(rawValue) ? Number(rawValue) : rawValue;
      ((root[section] as Record<string, any>)[metric] as Record<string, unknown>)[key] = value;
    }
  }

  return root;
}

function baselineMapKeys(map: Map<string, unknown>): string[] {
  return Array.from(map.keys());
}

function toDiffMark(baseline: boolean, candidate: boolean): string {
  return `${baseline ? 'Y' : 'N'} -> ${candidate ? 'Y' : 'N'}`;
}

function isFailure(record: CaseRunRecord): boolean {
  return (
    !record.recall_hit ||
    !record.context_hit ||
    !record.citation_hit ||
    record.final_status === 'error'
  );
}

function roundRate(value: number): number {
  return Number(value.toFixed(4));
}

function roundDelta(value: number): number {
  return Number(value.toFixed(4));
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

async function writeJson(filePath: string, value: unknown) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

async function writeJsonl(filePath: string, rows: unknown[]) {
  await fs.writeFile(
    filePath,
    rows.map((row) => JSON.stringify(row)).join('\n') + '\n',
    'utf-8',
  );
}

async function readJson<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
