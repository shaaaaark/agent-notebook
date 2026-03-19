import { Document } from '@langchain/core/documents';
import type { ConfigService } from '@nestjs/config';
import { RagService } from './rag.service';

describe('RagService', () => {
  function createService(values: Record<string, unknown>) {
    const config = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;

    return new RagService(
      {} as any,
      config,
      {} as any,
      {} as any,
      {} as any,
    );
  }

  it('builds prompt from generation strategy config', () => {
    const service = createService({
      'generation.answerStrategy': 'cautious_grounded',
      'generation.requireCitations': false,
      'generation.maxEvidencePoints': 2,
      'generation.cautiousGroundedAnswerRuleTemplate': '先讲证据，再回答。',
    });

    const prompt = (service as any).buildPrompt('问题', '[E1] 证据');

    expect(prompt).toContain('先讲证据，再回答。');
    expect(prompt).toContain('引用证据编号是推荐项');
    expect(prompt).toContain('再补 2-2 条依据');
  });

  it('applies low / medium / high structured query risk actions', () => {
    const service = createService({
      'generation.clarifyMessageTemplate': '请补充「{{question}}」的背景。',
      'generation.abstainMessageTemplate': '「{{question}}」属于高风险问题，当前不直接回答。',
      'guardrails.enforcementMode': 'balanced',
      'guardrails.sensitivePatterns': [
        {
          id: 'medical-abstain',
          type: 'keyword',
          pattern: '医疗',
          weight: 5,
          action: 'abstain',
          caseSensitive: false,
        },
      ],
      'guardrails.riskIntents': [
        {
          id: 'contract-clarify',
          type: 'phrase',
          pattern: '合同审查',
          weight: 3,
          action: 'clarify',
          caseSensitive: false,
        },
        {
          id: 'finance-warning',
          type: 'regex',
          pattern: 'finance',
          weight: 1,
          action: 'allow_with_warning',
          caseSensitive: false,
        },
      ],
    });

    expect((service as any).getClarifyMessage('费用')).toBe('请补充「费用」的背景。');
    expect((service as any).getAbstainMessage('合同')).toBe(
      '「合同」属于高风险问题，当前不直接回答。',
    );
    expect((service as any).resolveQueryRiskAction('这是医疗建议吗')).toBe('abstain');
    expect((service as any).resolveQueryRiskAction('我需要合同审查')).toBe('clarify');
    expect((service as any).resolveQueryRiskAction('Need finance planning')).toBe(
      'allow_with_warning',
    );
    expect((service as any).resolveLowConfidenceStatus('abstain', true)).toBe('abstain');
    expect((service as any).resolveLowConfidenceStatus('clarify', true)).toBe('clarify');
    expect((service as any).resolveLowConfidenceStatus('allow_with_warning', true)).toBe(
      'clarify',
    );
    expect((service as any).applyQueryRiskAction('结论', 'allow_with_warning')).toContain(
      '提示：以下内容仅基于当前知识库证据',
    );
  });

  it('supports strict enforcement escalation on cumulative matched score', () => {
    const service = createService({
      'guardrails.enforcementMode': 'strict',
      'guardrails.sensitivePatterns': [],
      'guardrails.riskIntents': [
        {
          id: 'legal-clarify',
          type: 'keyword',
          pattern: 'legal',
          weight: 2,
          action: 'clarify',
          caseSensitive: false,
        },
        {
          id: 'review-warning',
          type: 'keyword',
          pattern: 'review',
          weight: 2,
          action: 'allow_with_warning',
          caseSensitive: false,
        },
      ],
    });

    expect((service as any).resolveQueryRiskAction('Need legal review')).toBe('clarify');
  });

  it('applies lexical thresholds and min-hits from retrieval policy in weak-signal detection', () => {
    const retrieval = {
      strategy: 'hybrid_rrf',
      degraded: false,
      chunks: [
        {
          doc: new Document({ pageContent: 'doc-1', metadata: { chunk_id: 'c1' } }),
          score: 0.02,
          scoreBm25: 2,
          scoreRrf: 0.02,
        },
        {
          doc: new Document({ pageContent: 'doc-2', metadata: { chunk_id: 'c2' } }),
          score: 0.02,
          scoreBm25: 1.2,
          scoreRrf: 0.01,
        },
      ],
    };
    const bm25BoundaryService = createService({
      'retrieve.lexicalSignal.minBm25Score': 2,
      'retrieve.lexicalSignal.minBm25Hits': 1,
      'retrieve.lexicalSignal.minRrfScore': 0.03,
      'guardrails.weakSignalRatio': 100,
      'guardrails.weakSignalFloor': 10,
      'guardrails.weakSignalHits': 3,
      'guardrails.weakSignalWindow': 2,
      'guardrails.weakSignalLexicalThreshold': 3,
    });

    expect((bm25BoundaryService as any).hasEnoughSignal(retrieval, 0.5)).toBe(true);

    const rrfBoundaryService = createService({
      'retrieve.lexicalSignal.minBm25Score': 3,
      'retrieve.lexicalSignal.minBm25Hits': 2,
      'retrieve.lexicalSignal.minRrfScore': 0.015,
      'guardrails.weakSignalRatio': 100,
      'guardrails.weakSignalFloor': 10,
      'guardrails.weakSignalHits': 3,
      'guardrails.weakSignalWindow': 2,
      'guardrails.weakSignalLexicalThreshold': 3,
    });

    expect((rrfBoundaryService as any).hasEnoughSignal(retrieval, 0.5)).toBe(true);
  });

  it('writes rerank observability fields into trace payload', () => {
    const service = createService({
      'policy.version': 'phase5-v1',
      'retrieve.topK': 8,
      'openai.model': 'gpt-5.4',
    });

    const trace = (service as any).buildTrace(
      '什么是状态提升',
      {
        requestId: 'req-1',
        retrieval: {
          chunks: [
            {
              doc: new Document({
                pageContent: 'React 状态提升',
                metadata: { chunk_id: 'c1', source: 'a.md' },
              }),
              score: 0.9,
              rerankScore: 0.8,
              rankFinal: 1,
            },
          ],
          strategy: 'hybrid_rrf_rerank',
          degraded: false,
          rerankProvider: 'bailian',
          rerankSkipped: false,
        },
        context: {
          selected: [],
          skipped: [],
          contextText: '',
          stats: { selectedCount: 0, tokenUsed: 0, truncated: false },
        },
        retrieveLatencyMs: 123,
        finalStatus: 'success',
        prompt: 'prompt',
        answer: 'answer',
        sources: [],
        queryRiskAction: null,
      },
      '答案 [E1]',
      456,
      100,
      50,
      'success',
    );

    expect(trace.rerank_provider).toBe('bailian');
    expect(trace.rerank_skipped).toBe(false);
    expect(trace.rerank_reason).toBeUndefined();
  });
});
