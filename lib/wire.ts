// The wires: every client request is normalised once, then built into
// whichever upstream wire the router picked; every provider answer is
// reduced to { text, inputTokens, outputTokens } and re-emitted in the
// client's wire. All six client x upstream pairs.
//
// What must survive the round trip (the env's wire checks compare the
// provider's echo against the client's request, field by field): the system
// text, the user text, the tool names, max_tokens, the stop sequences, the
// image bytes, and JSON mode. The provider's answer text is always one
// `ANSWER ECHO{...}` string: it is carried verbatim, whole, into the
// client's response, with the provider's exact usage and a stop reason in
// the normal family (stop / end_turn / STOP are one family).
//
// Streaming is buffered: the upstream stream is read whole, then re-emitted
// as the client's own stream. The answers are short (one echo), the env is
// local, and buffering keeps failover clean — the client sees nothing until
// a provider has answered. Deterministic: the same upstream answer gives the
// same bytes; fixed timestamps in the model lists; no clock anywhere.

import { isRecord, type Json } from './brief.ts';

export interface ImageRef {
  /** Base64 data with its media type, or a plain URL. */
  data?: string;
  mediaType?: string;
  url?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Json;
}

/** A client request, wire-neutral. */
export interface Normalised {
  system: string;
  userText: string;
  image: ImageRef | null;
  tools: ToolDef[];
  maxTokens: number | null;
  stops: string[];
  /** JSON mode the client asked for on the OpenAI wire only. */
  jsonMode: boolean;
  stream: boolean;
  temperature: number | null;
  topP: number | null;
}

/** A provider answer, wire-neutral. */
export interface Answer {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

const FIXED_OPENAI_CREATED = 1767225600;
const FIXED_ANTHROPIC_CREATED_AT = '2026-01-01T00:00:00Z';

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((b) => (isRecord(b) && b.type === 'text' && typeof b.text === 'string' ? [b.text] : []))
    .join('\n');
};

/** The image in a user message's content, either wire's spelling. */
function imageOf(content: unknown): ImageRef | null {
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === 'image_url' && isRecord(block.image_url) && typeof block.image_url.url === 'string') {
      const url = block.image_url.url;
      const m = /^data:([^;]+);base64,(.+)$/.exec(url);
      if (m !== null) return { data: m[2], mediaType: m[1] };
      return { url };
    }
    if (block.type === 'image' && isRecord(block.source)) {
      const source = block.source;
      if (source.type === 'base64' && typeof source.data === 'string') {
        return { data: source.data, mediaType: typeof source.media_type === 'string' ? source.media_type : 'image/png' };
      }
      if (source.type === 'url' && typeof source.url === 'string') return { url: source.url };
    }
  }
  return null;
}

function toolsOfOpenAI(body: Json): ToolDef[] {
  if (!Array.isArray(body.tools)) return [];
  return body.tools.flatMap((raw) => {
    if (!isRecord(raw) || !isRecord(raw.function) || typeof raw.function.name !== 'string') return [];
    return [
      {
        name: raw.function.name,
        description: typeof raw.function.description === 'string' ? raw.function.description : '',
        parameters: isRecord(raw.function.parameters) ? raw.function.parameters : { type: 'object', properties: {} },
      },
    ];
  });
}

function toolsOfAnthropic(body: Json): ToolDef[] {
  if (!Array.isArray(body.tools)) return [];
  return body.tools.flatMap((raw) => {
    if (!isRecord(raw) || typeof raw.name !== 'string') return [];
    return [
      {
        name: raw.name,
        description: typeof raw.description === 'string' ? raw.description : '',
        parameters: isRecord(raw.input_schema) ? raw.input_schema : { type: 'object', properties: {} },
      },
    ];
  });
}

const stopsOf = (v: unknown): string[] => {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return [];
};

/** An OpenAI Chat Completions body, normalised. */
export function normaliseOpenAI(body: Json): Normalised {
  const messages = Array.isArray(body.messages) ? body.messages.filter(isRecord) : [];
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => textOf(m.content))
    .filter((t) => t !== '')
    .join('\n');
  const users = messages.filter((m) => m.role === 'user');
  const lastUser = users.length > 0 ? users[users.length - 1] : null;
  const format = isRecord(body.response_format) ? body.response_format.type : undefined;
  return {
    system,
    userText: lastUser !== null ? textOf(lastUser.content) : '',
    image: lastUser !== null ? imageOf(lastUser.content) : null,
    tools: toolsOfOpenAI(body),
    maxTokens:
      typeof body.max_tokens === 'number'
        ? body.max_tokens
        : typeof body.max_completion_tokens === 'number'
          ? body.max_completion_tokens
          : null,
    stops: stopsOf(body.stop),
    jsonMode: format === 'json_object' || format === 'json_schema',
    stream: body.stream === true,
    temperature: typeof body.temperature === 'number' ? body.temperature : null,
    topP: typeof body.top_p === 'number' ? body.top_p : null,
  };
}

/** An Anthropic Messages body, normalised. */
export function normaliseAnthropic(body: Json): Normalised {
  const messages = Array.isArray(body.messages) ? body.messages.filter(isRecord) : [];
  const users = messages.filter((m) => m.role === 'user');
  const lastUser = users.length > 0 ? users[users.length - 1] : null;
  return {
    system: textOf(body.system),
    userText: lastUser !== null ? textOf(lastUser.content) : '',
    image: lastUser !== null ? imageOf(lastUser.content) : null,
    tools: toolsOfAnthropic(body),
    maxTokens: typeof body.max_tokens === 'number' ? body.max_tokens : null,
    stops: stopsOf(body.stop_sequences),
    // Anthropic has no JSON-mode signal the env reads: the client's echo
    // always carries json_mode false, so no upstream JSON signalling either.
    jsonMode: false,
    stream: body.stream === true,
    temperature: typeof body.temperature === 'number' ? body.temperature : null,
    topP: typeof body.top_p === 'number' ? body.top_p : null,
  };
}

// ---- upstream requests ----

function openAIImagePart(image: ImageRef): Json {
  if (image.data !== undefined) {
    return { type: 'image_url', image_url: { url: `data:${image.mediaType ?? 'image/png'};base64,${image.data}` } };
  }
  return { type: 'image_url', image_url: { url: image.url ?? '' } };
}

function anthropicImageBlock(image: ImageRef): Json {
  if (image.data !== undefined) {
    return { type: 'image', source: { type: 'base64', media_type: image.mediaType ?? 'image/png', data: image.data } };
  }
  return { type: 'image', source: { type: 'url', url: image.url ?? '' } };
}

function geminiImagePart(image: ImageRef): Json {
  if (image.data !== undefined) {
    return { inlineData: { mimeType: image.mediaType ?? 'image/png', data: image.data } };
  }
  return { fileData: { mimeType: image.mediaType ?? 'image/png', fileUri: image.url ?? '' } };
}

/** The normalised request as an OpenAI Chat Completions body naming `model`. */
export function toOpenAIRequest(req: Normalised, model: string): Json {
  const messages: Json[] = [];
  if (req.system !== '') messages.push({ role: 'system', content: req.system });
  const userContent: Json[] = [{ type: 'text', text: req.userText }];
  if (req.image !== null) userContent.push(openAIImagePart(req.image));
  messages.push({ role: 'user', content: userContent });
  const out: Json = { model, messages };
  if (req.tools.length > 0) {
    out.tools = req.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    out.tool_choice = 'auto';
  }
  if (req.maxTokens !== null) out.max_tokens = req.maxTokens;
  if (req.stops.length > 0) out.stop = req.stops;
  if (req.temperature !== null) out.temperature = req.temperature;
  if (req.topP !== null) out.top_p = req.topP;
  if (req.jsonMode) out.response_format = { type: 'json_object' };
  if (req.stream) {
    out.stream = true;
    out.stream_options = { include_usage: true };
  }
  return out;
}

/** The normalised request as an Anthropic Messages body naming `model`. */
export function toAnthropicRequest(req: Normalised, model: string): Json {
  const content: Json[] = [{ type: 'text', text: req.userText }];
  if (req.image !== null) content.push(anthropicImageBlock(req.image));
  const out: Json = { model, messages: [{ role: 'user', content }] };
  if (req.system !== '') out.system = req.system;
  if (req.tools.length > 0) {
    out.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  }
  if (req.maxTokens !== null) out.max_tokens = req.maxTokens;
  if (req.stops.length > 0) out.stop_sequences = req.stops;
  if (req.temperature !== null) out.temperature = req.temperature;
  if (req.topP !== null) out.top_p = req.topP;
  if (req.stream) out.stream = true;
  return out;
}

/** The normalised request as a Gemini generateContent body. */
export function toGeminiRequest(req: Normalised): Json {
  const parts: Json[] = [{ text: req.userText }];
  if (req.image !== null) parts.push(geminiImagePart(req.image));
  const out: Json = { contents: [{ role: 'user', parts }] };
  if (req.system !== '') out.systemInstruction = { parts: [{ text: req.system }] };
  if (req.tools.length > 0) {
    out.tools = [
      {
        functionDeclarations: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ];
  }
  const config: Json = {};
  if (req.maxTokens !== null) config.maxOutputTokens = req.maxTokens;
  if (req.stops.length > 0) config.stopSequences = req.stops;
  if (req.temperature !== null) config.temperature = req.temperature;
  if (req.topP !== null) config.topP = req.topP;
  if (req.jsonMode) config.responseMimeType = 'application/json';
  if (Object.keys(config).length > 0) out.generationConfig = config;
  return out;
}

// ---- upstream answers ----

const numOrZero = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Split SSE text into data payloads (one per frame). */
function ssePayloads(text: string): string[] {
  const out: string[] = [];
  for (const frame of text.replace(/\r\n/g, '\n').split('\n\n')) {
    for (const line of frame.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) out.push(trimmed.slice(5).trim());
    }
  }
  return out;
}

function parseOpenAIAnswer(body: string, streamed: boolean): Answer | null {
  if (!streamed) {
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      return null;
    }
    if (!isRecord(value)) return null;
    const choices = Array.isArray(value.choices) ? value.choices : [];
    const message = isRecord(choices[0]) && isRecord(choices[0].message) ? choices[0].message : {};
    const usage = isRecord(value.usage) ? value.usage : {};
    return {
      text: typeof message.content === 'string' ? message.content : textOf(message.content),
      inputTokens: numOrZero(usage.prompt_tokens),
      outputTokens: numOrZero(usage.completion_tokens),
    };
  }
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  for (const payload of ssePayloads(body)) {
    if (payload === '[DONE]') continue;
    let chunk: unknown;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue;
    }
    if (!isRecord(chunk)) continue;
    if (isRecord(chunk.usage)) {
      inputTokens = numOrZero(chunk.usage.prompt_tokens);
      outputTokens = numOrZero(chunk.usage.completion_tokens);
    }
    const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
    const delta = isRecord(choices[0]) && isRecord(choices[0].delta) ? choices[0].delta : {};
    if (typeof delta.content === 'string') text += delta.content;
  }
  return { text, inputTokens, outputTokens };
}

function parseAnthropicAnswer(body: string, streamed: boolean): Answer | null {
  if (!streamed) {
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      return null;
    }
    if (!isRecord(value)) return null;
    const usage = isRecord(value.usage) ? value.usage : {};
    return {
      text: textOf(value.content),
      inputTokens: numOrZero(usage.input_tokens),
      outputTokens: numOrZero(usage.output_tokens),
    };
  }
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  for (const payload of ssePayloads(body)) {
    let event: unknown;
    try {
      event = JSON.parse(payload);
    } catch {
      continue;
    }
    if (!isRecord(event)) continue;
    if (event.type === 'message_start' && isRecord(event.message) && isRecord(event.message.usage)) {
      inputTokens = numOrZero(event.message.usage.input_tokens);
    }
    if (event.type === 'content_block_delta' && isRecord(event.delta) && event.delta.type === 'text_delta') {
      if (typeof event.delta.text === 'string') text += event.delta.text;
    }
    if (event.type === 'message_delta' && isRecord(event.usage)) {
      outputTokens = numOrZero(event.usage.output_tokens);
    }
  }
  return { text, inputTokens, outputTokens };
}

function parseGeminiAnswer(body: string, streamed: boolean): Answer | null {
  const readFrame = (value: unknown): { text: string; input: number; output: number } | null => {
    if (!isRecord(value)) return null;
    const candidates = Array.isArray(value.candidates) ? value.candidates : [];
    const first = isRecord(candidates[0]) ? candidates[0] : null;
    const content = first !== null && isRecord(first.content) ? first.content : {};
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const text = parts
      .flatMap((p) => (isRecord(p) && typeof p.text === 'string' ? [p.text] : []))
      .join('');
    const meta = isRecord(value.usageMetadata) ? value.usageMetadata : {};
    return {
      text,
      input: numOrZero(meta.promptTokenCount),
      output: numOrZero(meta.candidatesTokenCount),
    };
  };
  if (!streamed) {
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      return null;
    }
    const frame = readFrame(value);
    if (frame === null) return null;
    return { text: frame.text, inputTokens: frame.input, outputTokens: frame.output };
  }
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  for (const payload of ssePayloads(body)) {
    let value: unknown;
    try {
      value = JSON.parse(payload);
    } catch {
      continue;
    }
    const frame = readFrame(value);
    if (frame === null) continue;
    text += frame.text;
    if (frame.input !== 0) inputTokens = frame.input;
    if (frame.output !== 0) outputTokens = frame.output;
  }
  return { text, inputTokens, outputTokens };
}

/** Parse a provider's answer body in its wire, streamed or not. */
export function parseAnswer(wire: 'openai' | 'anthropic' | 'gemini', body: string, streamed: boolean): Answer | null {
  if (wire === 'openai') return parseOpenAIAnswer(body, streamed);
  if (wire === 'anthropic') return parseAnthropicAnswer(body, streamed);
  return parseGeminiAnswer(body, streamed);
}

/** The refusal message inside a provider's error body, whatever its wire. */
export function errorMessage(body: string): string {
  try {
    const value: unknown = JSON.parse(body);
    if (isRecord(value) && isRecord(value.error) && typeof value.error.message === 'string') {
      return value.error.message;
    }
    if (isRecord(value) && typeof value.message === 'string') return value.message;
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return body.slice(0, 500);
}

// ---- client responses ----

export function openAIError(message: string, type: string): Json {
  return { error: { message, type, code: null } };
}

export function anthropicError(type: string, message: string): Json {
  return { type: 'error', error: { type, message } };
}

export interface ServedModel {
  id: string;
  provider: string;
  displayName: string;
}

export function openAIModelList(models: readonly ServedModel[]): Json {
  return {
    object: 'list',
    data: models.map((m) => ({ id: m.id, object: 'model', created: FIXED_OPENAI_CREATED, owned_by: m.provider })),
  };
}

export function anthropicModelList(models: readonly ServedModel[]): Json {
  return {
    data: models.map((m) => ({ type: 'model', id: m.id, display_name: m.displayName, created_at: FIXED_ANTHROPIC_CREATED_AT })),
    has_more: false,
  };
}

/** The answer as an OpenAI Chat Completions JSON object. */
export function toOpenAIJson(answer: Answer, model: string): Json {
  return {
    id: 'chatcmpl-aggregate',
    object: 'chat.completion',
    created: FIXED_OPENAI_CREATED,
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: answer.text }, finish_reason: 'stop', logprobs: null }],
    usage: {
      prompt_tokens: answer.inputTokens,
      completion_tokens: answer.outputTokens,
      total_tokens: answer.inputTokens + answer.outputTokens,
    },
  };
}

/** The answer as an Anthropic Messages JSON object. */
export function toAnthropicJson(answer: Answer, model: string): Json {
  return {
    id: 'msg_aggregate',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: answer.text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: answer.inputTokens, output_tokens: answer.outputTokens },
  };
}

const sse = (event: string | null, data: unknown): string =>
  `${event === null ? '' : `event: ${event}\n`}data: ${JSON.stringify(data)}\n\n`;

/** The answer as an OpenAI SSE stream: role, content, finish, usage, [DONE]. */
export function toOpenAIStream(answer: Answer, model: string): string {
  const chunk = (delta: Json, finish: string | null): Json => ({
    id: 'chatcmpl-aggregate',
    object: 'chat.completion.chunk',
    created: FIXED_OPENAI_CREATED,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  });
  return (
    sse(null, chunk({ role: 'assistant', content: '' }, null)) +
    sse(null, chunk({ content: answer.text }, null)) +
    sse(null, chunk({}, 'stop')) +
    sse(null, {
      id: 'chatcmpl-aggregate',
      object: 'chat.completion.chunk',
      created: FIXED_OPENAI_CREATED,
      model,
      choices: [],
      usage: {
        prompt_tokens: answer.inputTokens,
        completion_tokens: answer.outputTokens,
        total_tokens: answer.inputTokens + answer.outputTokens,
      },
    }) +
    'data: [DONE]\n\n'
  );
}

/** The answer as an Anthropic SSE stream, in the required event order. */
export function toAnthropicStream(answer: Answer, model: string): string {
  return (
    sse('message_start', {
      type: 'message_start',
      message: {
        id: 'msg_aggregate',
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: answer.inputTokens, output_tokens: 0 },
      },
    }) +
    sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
    sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: answer.text } }) +
    sse('content_block_stop', { type: 'content_block_stop', index: 0 }) +
    sse('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: answer.outputTokens },
    }) +
    sse('message_stop', { type: 'message_stop' })
  );
}
