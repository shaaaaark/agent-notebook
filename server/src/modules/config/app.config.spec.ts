describe('appConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('loads final runtime policy schema for retrieval/context/generation/guardrails', () => {
    jest.doMock('fs', () => ({
      existsSync: jest.fn(() => true),
      readFileSync: jest.fn(
        () => `version: phase5-test
retrieve:
  lexical_signal:
    min_bm25_score: 0.2
    min_bm25_hits: 2
    min_rrf_score: 0.15
context:
  max_context_tokens: 4096
  min_selected_chunks: 5
  min_incremental_coverage: 0.12
generation:
  temperature: 0.3
  answer_strategy: cautious_grounded
  require_citations: false
  max_evidence_points: 2
  direct_grounded_answer_rule_template: 先直接答。
  cautious_grounded_answer_rule_template: 先讲证据范围。
  clarify_message_template: 请补充「{{question}}」相关资料。
  abstain_message_template: 「{{question}}」当前不能直接下结论。
guardrails:
  enforcement_mode: strict
  sensitive_patterns:
    - id: medical-abstain
      type: keyword
      pattern: 医疗
      weight: 5
      action: abstain
  risk_intents:
    - id: finance-warning
      type: regex
      pattern: "(投资|finance)"
      weight: 1
      action: allow_with_warning
`,
      ),
    }));

    const { appConfig } = require('./app.config');
    const config = appConfig();

    expect(config.retrieve.lexicalSignal.minBm25Score).toBe(0.2);
    expect(config.retrieve.lexicalSignal.minBm25Hits).toBe(2);
    expect(config.retrieve.lexicalSignal.minRrfScore).toBe(0.15);
    expect(config.context.maxContextTokens).toBe(4096);
    expect(config.context.tokenBudget).toBe(4096);
    expect(config.context.minSelectedChunks).toBe(5);
    expect(config.context.minIncrementalCoverage).toBe(0.12);
    expect(config.generation.temperature).toBe(0.3);
    expect(config.generation.answerStrategy).toBe('cautious_grounded');
    expect(config.generation.requireCitations).toBe(false);
    expect(config.generation.maxEvidencePoints).toBe(2);
    expect(config.generation.directGroundedAnswerRuleTemplate).toBe('先直接答。');
    expect(config.generation.cautiousGroundedAnswerRuleTemplate).toBe('先讲证据范围。');
    expect(config.generation.clarifyMessageTemplate).toBe('请补充「{{question}}」相关资料。');
    expect(config.generation.abstainMessageTemplate).toBe('「{{question}}」当前不能直接下结论。');
    expect(config.guardrails.enforcementMode).toBe('strict');
    expect(config.guardrails.sensitivePatterns).toEqual([
      {
        id: 'medical-abstain',
        type: 'keyword',
        pattern: '医疗',
        weight: 5,
        action: 'abstain',
        caseSensitive: false,
      },
    ]);
    expect(config.guardrails.riskIntents).toEqual([
      {
        id: 'finance-warning',
        type: 'regex',
        pattern: '(投资|finance)',
        weight: 1,
        action: 'allow_with_warning',
        caseSensitive: false,
      },
    ]);
    expect(config.openai.temperature).toBe(0.3);
  });
});
