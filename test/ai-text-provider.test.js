/**
 * The AI assistant talks to GroqCloud when a Groq key is set, to OpenAI when
 * only an OpenAI key is, and spends the monthly budget either way.
 *
 * @module test/ai-text-provider
 */

const mockCreate = jest.fn();
const mockClientOptions = [];

jest.mock('openai', () => jest.fn().mockImplementation((options) => {
  mockClientOptions.push(options);
  return { chat: { completions: { create: mockCreate } } };
}));

jest.mock('../services/ai-budget', () => ({
  checkAndReserveBudget: jest.fn(() => Promise.resolve(true)),
  releaseBudget: jest.fn(() => Promise.resolve()),
  recordUsage: jest.fn(() => Promise.resolve()),
}));

const budget = require('../services/ai-budget');
const { generateText, isAIConfigured, resolveProvider } = require('../services/aiText');

const ENV_KEYS = ['GROQ_API_KEY', 'OPENAI_API_KEY', 'AI_PROVIDER', 'AI_MODEL'];
const savedEnv = {};
const user = { userId: '550e8400-e29b-41d4-a716-446655440000', organizationId: 3 };

/** A completion answering with the given JSON content. */
function answer(content, finishReason = 'stop') {
  return {
    choices: [{ finish_reason: finishReason, message: { content } }],
    usage: { prompt_tokens: 1000, completion_tokens: 500 },
  };
}

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  ENV_KEYS.forEach((key) => { savedEnv[key] = process.env[key]; });
});

afterAll(() => {
  ENV_KEYS.forEach((key) => {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  });
});

beforeEach(() => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  jest.clearAllMocks();
  mockClientOptions.length = 0;
});

test('without any key the assistant is unavailable and spends nothing', async () => {
  expect(isAIConfigured()).toBe(false);
  await expect(generateText('rewrite', { tone: 'professional', text: 'Salut' }, user))
    .rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
  expect(budget.checkAndReserveBudget).not.toHaveBeenCalled();
});

test('a Groq key sends the request to GroqCloud with its default model', async () => {
  process.env.GROQ_API_KEY = 'gsk_test';
  mockCreate.mockResolvedValue(answer('{"text":"Bonjour"}'));

  const result = await generateText('rewrite', { tone: 'professional', text: 'Salut' }, user);

  expect(result.data).toEqual({ text: 'Bonjour' });
  expect(result.usage).toMatchObject({ provider: 'groq', model: 'openai/gpt-oss-120b' });
  expect(mockClientOptions.at(-1)).toEqual({ apiKey: 'gsk_test', baseURL: 'https://api.groq.com/openai/v1' });
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
    model: 'openai/gpt-oss-120b',
    response_format: { type: 'json_object' },
    reasoning_effort: 'low',
  }));
  expect(budget.recordUsage).toHaveBeenCalledWith(expect.objectContaining({
    provider: 'groq', success: true, input_tokens: 1000, output_tokens: 500,
  }));
});

test('with both keys Groq is preferred, unless AI_PROVIDER names OpenAI', () => {
  process.env.GROQ_API_KEY = 'gsk_test';
  process.env.OPENAI_API_KEY = 'sk_test';
  expect(resolveProvider().name).toBe('groq');

  process.env.AI_PROVIDER = 'openai';
  expect(resolveProvider()).toMatchObject({ name: 'openai', model: 'gpt-4o-mini' });
});

test('an OpenAI key alone keeps the assistant working on OpenAI', () => {
  process.env.OPENAI_API_KEY = 'sk_test';
  expect(resolveProvider()).toMatchObject({ name: 'openai', apiKey: 'sk_test' });
});

test('AI_MODEL picks another model of the provider', () => {
  process.env.GROQ_API_KEY = 'gsk_test';
  process.env.AI_MODEL = 'openai/gpt-oss-20b';
  expect(resolveProvider().model).toBe('openai/gpt-oss-20b');
});

test('an answer cut off at the token limit is reported, and its tokens are still counted', async () => {
  process.env.GROQ_API_KEY = 'gsk_test';
  mockCreate.mockResolvedValue(answer('{"text":"Bonj', 'length'));

  await expect(generateText('rewrite', { tone: 'professional', text: 'Salut' }, user))
    .rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  expect(budget.recordUsage).toHaveBeenCalledWith(expect.objectContaining({
    success: false, error_code: 'AI_INVALID_RESPONSE', output_tokens: 500,
  }));
});

test('an answer that is not a JSON object is reported', async () => {
  process.env.GROQ_API_KEY = 'gsk_test';
  mockCreate.mockResolvedValue(answer('Voici votre texte'));

  await expect(generateText('rewrite', { tone: 'professional', text: 'Salut' }, user))
    .rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
});

test('a provider failure releases the whole reservation', async () => {
  process.env.GROQ_API_KEY = 'gsk_test';
  mockCreate.mockRejectedValue(Object.assign(new Error('Invalid API Key'), { status: 401 }));

  await expect(generateText('rewrite', { tone: 'professional', text: 'Salut' }, user)).rejects.toMatchObject({ status: 401 });
  const reserved = budget.checkAndReserveBudget.mock.calls[0][0];
  expect(budget.releaseBudget).toHaveBeenCalledWith(reserved);
});

test('nothing is sent once the monthly budget is spent', async () => {
  process.env.GROQ_API_KEY = 'gsk_test';
  budget.checkAndReserveBudget.mockResolvedValueOnce(false);

  await expect(generateText('rewrite', { tone: 'professional', text: 'Salut' }, user))
    .rejects.toMatchObject({ code: 'AI_BUDGET_EXCEEDED' });
  expect(mockCreate).not.toHaveBeenCalled();
});
