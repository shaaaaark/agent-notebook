import * as fs from 'fs/promises';
import * as path from 'path';

type TraceChunkRecord = {
  chunk_id: string;
  source: string;
  score: number;
};

type RequestTrace = {
  request_id: string;
  timestamp: string;
  query_raw: string;
  retrieved_chunks: TraceChunkRecord[];
  selected_sources?: string[];
  final_status: string;
  user_feedback?: 1 | -1;
};

type FailureDraft = {
  request_id: string;
  timestamp: string;
  question: string;
  final_status: string;
  user_feedback?: 1 | -1;
  reasons: string[];
  retrieved_sources: string[];
  selected_sources: string[];
  draft_case: {
    case_id: string;
    category: string;
    question: string;
    expected_points: string[];
    must_cite: boolean;
    gold_sources: string[];
    constraints: string[];
  };
};

type CliArgs = {
  days: number;
  traceDir?: string;
  output?: string;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const traceDir = resolveTraceDir(args.traceDir);
  const outputPath = resolveOutputPath(args.output);
  const cutoff = Date.now() - args.days * 24 * 60 * 60 * 1000;

  const traces = await loadTraces(traceDir);
  const drafts = traces
    .filter((trace) => {
      const time = Date.parse(trace.timestamp);
      return Number.isFinite(time) && time >= cutoff;
    })
    .filter((trace) => shouldCollect(trace))
    .map((trace) => toFailureDraft(trace));

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        trace_dir: traceDir,
        window_days: args.days,
        total_candidates: drafts.length,
        items: drafts,
      },
      null,
      2,
    )}\n`,
    'utf-8',
  );

  process.stdout.write(
    `Collected ${drafts.length} candidate cases -> ${displayPath(outputPath)}\n`,
  );
}

function parseArgs(argv: string[]): CliArgs {
  let days = 7;
  let traceDir: string | undefined;
  let output: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (!current.startsWith('--') || !next || next.startsWith('--')) {
      continue;
    }

    if (current === '--days') {
      days = parseInt(next, 10);
    }
    if (current === '--trace-dir') {
      traceDir = next;
    }
    if (current === '--output') {
      output = next;
    }
    index += 1;
  }

  if (!Number.isInteger(days) || days < 1) {
    throw new Error('--days must be a positive integer');
  }

  return { days, traceDir, output };
}

function resolveTraceDir(input?: string): string {
  return input
    ? path.resolve(process.cwd(), input)
    : path.resolve(process.cwd(), 'logs', 'traces');
}

function resolveOutputPath(input?: string): string {
  if (input) {
    return path.resolve(process.cwd(), input);
  }

  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  return path.resolve(process.cwd(), 'eval', 'inbox', `failure-drafts_${stamp}.json`);
}

function displayPath(targetPath: string): string {
  const relative = path.relative(process.cwd(), targetPath);
  if (!relative || relative.startsWith('..')) {
    return targetPath;
  }
  return relative;
}

async function loadTraces(traceDir: string): Promise<RequestTrace[]> {
  let entries: string[];
  try {
    entries = (await fs.readdir(traceDir))
      .filter((entry) => entry.endsWith('.jsonl'))
      .sort();
  } catch {
    return [];
  }

  const groups = await Promise.all(
    entries.map(async (entry) => {
      const content = await fs.readFile(path.join(traceDir, entry), 'utf-8');
      return content
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as RequestTrace);
    }),
  );

  return groups.flat().sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function shouldCollect(trace: RequestTrace): boolean {
  return (
    trace.final_status === 'clarify' ||
    trace.final_status === 'abstain' ||
    trace.user_feedback === -1
  );
}

function toFailureDraft(trace: RequestTrace): FailureDraft {
  const reasons: string[] = [];

  if (trace.final_status === 'clarify') reasons.push('clarify');
  if (trace.final_status === 'abstain') reasons.push('abstain');
  if (trace.user_feedback === -1) reasons.push('negative_feedback');

  const retrievedSources = Array.from(
    new Set(trace.retrieved_chunks?.map((item) => item.source) ?? []),
  );
  const selectedSources = Array.from(new Set(trace.selected_sources ?? []));
  const shortId = trace.request_id.replace(/-/g, '').slice(0, 8) || 'unknown';

  return {
    request_id: trace.request_id,
    timestamp: trace.timestamp,
    question: trace.query_raw,
    final_status: trace.final_status,
    ...(trace.user_feedback ? { user_feedback: trace.user_feedback } : {}),
    reasons,
    retrieved_sources: retrievedSources,
    selected_sources: selectedSources,
    draft_case: {
      case_id: `draft-${shortId}`,
      category: 'triage',
      question: trace.query_raw,
      expected_points: [],
      must_cite: true,
      gold_sources: [],
      constraints: [
        'TODO: 人工补充 expected_points',
        'TODO: 人工确认 gold_sources',
      ],
    },
  };
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
