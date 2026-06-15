export const DEFAULT_API_BASE = 'https://pucoding.com';
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2';
export const DEFAULT_ASSISTANT_MODEL = 'claude-sonnet-4-6';

export type AssistantResult = { message: string; chips: string[]; model?: string };
export type GenerateResult = { id?: string; type: 'image'; url: string; localUri?: string; prompt?: string; revised_prompt?: string; elapsed?: number; createdAt?: number };
export type DirectApiConfig = { apiBase: string; apiKey: string; imageModel: string; assistantModel: string };
export type RefImage = { name: string; uri: string; mimeType?: string };

type Json = Record<string, any>;

// 本地 AI Studio 生图慢，默认 fetch 走系统 60s 超时会被掐断。
// 统一拉满到 300s；测试连接等轻量请求另传短超时（快速失败）。
const DEFAULT_TIMEOUT_MS = 300_000;
const HEALTH_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new Error(`请求超时（已等待 ${Math.round(timeoutMs / 1000)} 秒），请检查本地服务或稍后重试。timeout`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBaseUrl(input: string) {
  return String(input || '').trim().replace(/\/v1\/?$/, '').replace(/\/$/, '');
}

function headersFor(config: DirectApiConfig, json = true) {
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (config.apiKey?.trim()) headers.Authorization = `Bearer ${config.apiKey.trim()}`;
  return headers;
}

function firstString(...values: any[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const nested = firstString(...value);
      if (nested) return nested;
    }
    if (value && typeof value === 'object') {
      const nested = firstString(
        value.text,
        value.content,
        value.output_text,
        value.message,
        value.value,
        value.optimized,
        value.result,
        value.response,
        value.data,
        value.url,
        value.image_url,
      );
      if (nested) return nested;
    }
  }
  return '';
}

function normalizeMaybeBase64(value: string) {
  if (!value) return '';
  const trimmed = value.trim();
  const jsonLike = trimmed.startsWith('{') || trimmed.startsWith('[');
  if (jsonLike) return trimmed;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:image/') || trimmed.startsWith('file:')) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('/')) return trimmed;
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed) && trimmed.length > 100) {
    return 'data:image/png;base64,' + trimmed.replace(/\s+/g, '');
  }
  return trimmed;
}

function parseJsonText(value: string): any {
  const trimmed = value.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return null;
  try { return JSON.parse(trimmed); } catch { return null; }
}

function deepFindByKeys(value: any, keys: string[], seen = new Set<any>()): string {
  if (!value) return '';
  if (typeof value === 'string') return '';
  if (typeof value !== 'object') return '';
  if (seen.has(value)) return '';
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFindByKeys(item, keys, seen);
      if (found) return found;
    }
    return '';
  }
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  for (const key of Object.keys(value)) {
    const found = deepFindByKeys(value[key], keys, seen);
    if (found) return found;
  }
  return '';
}

function contentText(value: any): string {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value.map(contentText).filter(Boolean).join('\n').trim();
  }
  if (typeof value === 'object') {
    return firstString(
      value.text,
      value.content,
      value.output_text,
      value.message,
      value.value,
      value.response_text,
      value.delta?.content,
    ) || '';
  }
  return '';
}

async function apiPost(config: DirectApiConfig, path: string, body: unknown): Promise<Json> {
  const baseUrl = normalizeBaseUrl(config.apiBase);
  const res = await fetchWithTimeout(`${baseUrl}${path}`, {
    method: 'POST',
    headers: headersFor(config),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok || json.error) throw new Error(json.error?.message || json.error || json.raw || `HTTP ${res.status}`);
  return json as Json;
}

function extractTextResponse(raw: any): string {
  const direct = firstString(
    raw?.output_text,
    raw?.text,
    raw?.optimized,
    raw?.result,
    raw?.content_text,
    raw?.response_text,
    raw?.data?.optimized,
    raw?.data?.result,
    raw?.data?.text,
    raw?.data?.content,
    raw?.data?.output_text,
    raw?.data?.message,
    raw?.data?.choices?.[0]?.message?.content,
    raw?.data?.choices?.[0]?.text,
    raw?.choices?.[0]?.message?.content,
    raw?.choices?.[0]?.text,
    raw?.choices?.[0]?.delta?.content,
    raw?.choices?.[0]?.content,
  );
  if (direct) {
    const parsed = parseJsonText(direct);
    if (parsed) return extractTextResponse(parsed) || direct;
    return direct;
  }

  const deep = deepFindByKeys(raw, ['optimized', 'result', 'output_text', 'text', 'content', 'message', 'response_text']);
  if (deep) {
    const parsed = parseJsonText(deep);
    if (parsed) return extractTextResponse(parsed) || deep;
    return deep;
  }

  const output = raw?.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const content = item?.content;
      if (Array.isArray(content)) {
        for (const part of content) {
          const text = firstString(part?.text, part?.content, part?.output_text);
          if (text) return text;
        }
      }
      const text = firstString(item?.text, item?.content, item?.output_text);
      if (text) return text;
    }
  }

  const response = raw?.response;
  if (response) {
    const text: string = extractTextResponse(response);
    if (text) return text;
  }

  return '';
}

async function requestAssistantText(config: DirectApiConfig, system: string, user: string) {
  const baseUrl = normalizeBaseUrl(config.apiBase);
  const attempts = [
    {
      path: '/v1/chat/completions',
      body: {
        model: config.assistantModel,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.45,
        max_tokens: 700,
      },
    },
    {
      path: '/v1/responses',
      body: {
        model: config.assistantModel,
        input: `${system}\n\n${user}`,
        temperature: 0.45,
        max_output_tokens: 700,
      },
    },
  ];

  let lastErr = '';
  for (const attempt of attempts) {
    try {
      const res = await fetchWithTimeout(`${baseUrl}${attempt.path}`, {
        method: 'POST',
        headers: headersFor(config),
        body: JSON.stringify(attempt.body),
      });
      const text = await res.text();
      let json: any = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { raw: text };
      }
      if (!res.ok || json.error) throw new Error(json.error?.message || json.error || json.raw || `HTTP ${res.status}`);
      const extracted = extractTextResponse(json);
      if (extracted) return extracted;
      throw new Error('未返回可用文本');
    } catch (e: any) {
      lastErr = String(e?.message || e);
      if (!/chat\/completions|responses|unsupported|not found|404|invalid|not compatible|not support/i.test(lastErr)) throw e;
    }
  }
  throw new Error(lastErr || 'Assistant API failed');
}

function asImageUrl(item: any): string {
  if (!item) return '';
  if (typeof item === 'string') {
    return normalizeMaybeBase64(item);
  }
  if (typeof item.url === 'string' && item.url) return normalizeMaybeBase64(item.url);
  if (typeof item.image_url === 'string' && item.image_url) return normalizeMaybeBase64(item.image_url);
  if (typeof item.image === 'string' && item.image) return asImageUrl(item.image);
  if (typeof item.b64_json === 'string' && item.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (typeof item.base64 === 'string' && item.base64) return `data:image/png;base64,${item.base64}`;
  if (typeof item.png_base64 === 'string' && item.png_base64) return `data:image/png;base64,${item.png_base64}`;
  return '';
}

function pickImageCandidate(raw: any) {
  const pools = [
    raw?.data,
    raw?.images,
    raw?.output,
    raw?.results,
    raw?.result?.images,
    raw?.result,
    raw?.image,
  ];
  for (const pool of pools) {
    if (Array.isArray(pool)) {
      for (const item of pool) {
        const url = asImageUrl(item);
        if (url) return { item, url };
      }
    } else if (pool) {
      const url = asImageUrl(pool);
      if (url) return { item: pool, url };
    }
  }
  const direct = asImageUrl(raw);
  if (direct) return { item: raw, url: direct };
  return null;
}

function normalizeImageUrl(url: string, baseUrl: string) {
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `${baseUrl}${url}`;
  return url;
}

// 比例 × 分辨率 → 实际像素。中转站已支持 2K/4K。
// resolution: 'std'(标准 1K) | '2k' | '4k'
const SIZE_TABLE: Record<string, Record<string, string>> = {
  std: { '1:1': '1024x1024', '16:9': '1792x1024', '9:16': '1024x1792' },
  '2k': { '1:1': '2048x2048', '16:9': '2560x1440', '9:16': '1440x2560' },
  '4k': { '1:1': '4096x4096', '16:9': '3840x2160', '9:16': '2160x3840' },
};

function sizeValue(size: string, resolution = 'std') {
  const tier = SIZE_TABLE[resolution] || SIZE_TABLE.std;
  return tier[size] || tier['1:1'];
}

function imageUrlFromResponse(data: Json) {
  const deep = deepFindByKeys(data, ['url', 'image_url', 'imageUrl', 'image', 'b64_json', 'base64', 'png_base64']);
  if (deep) return normalizeMaybeBase64(deep);
  const direct = firstString(
    data?.url,
    data?.image,
    data?.image_url,
    data?.imageUrl,
    data?.output,
    data?.result,
    data?.content,
    data?.output_text,
    data?.response,
    data?.data?.url,
    data?.data?.image,
    data?.data?.image_url,
    data?.data?.imageUrl,
    data?.data?.output,
    data?.data?.result,
    data?.data?.content,
    data?.data?.output_text,
    data?.data?.response,
    data?.data?.[0]?.url,
    data?.data?.[0]?.image,
    data?.data?.[0]?.image_url,
    data?.data?.[0]?.b64_json,
    data?.data?.[0]?.base64,
    data?.data?.[0]?.png_base64,
    data?.data?.[0]?.content?.[0]?.text,
    data?.data?.[0]?.content?.[0]?.output_text,
    data?.images?.[0]?.url,
    data?.images?.[0]?.image_url,
    data?.images?.[0]?.b64_json,
    data?.images?.[0]?.base64,
    data?.output?.[0]?.url,
    data?.output?.[0]?.image_url,
    data?.output?.[0]?.b64_json,
    data?.output?.[0]?.base64,
    data?.output?.[0]?.content?.[0]?.text,
    data?.output?.[0]?.content?.[0]?.output_text,
    data?.response?.output?.[0]?.content?.[0]?.text,
    data?.response?.output?.[0]?.content?.[0]?.output_text,
    data?.response?.output_text,
    data?.choices?.[0]?.message?.content,
    data?.choices?.[0]?.text,
    data?.choices?.[0]?.delta?.content,
    data?.choices?.[0]?.content,
  );
  if (!direct) return '';
  return normalizeMaybeBase64(contentText(direct) || direct);
}

function revisedPromptFromResponse(data: Json) {
  return firstString(
    data?.revised_prompt,
    data?.revisedPrompt,
    data?.prompt,
    data?.data?.revised_prompt,
    data?.data?.revisedPrompt,
    data?.response?.revised_prompt,
    data?.response?.prompt,
  );
}

function assertImageResult(data: Json): GenerateResult {
  const found = pickImageCandidate(data);
  const url = normalizeImageUrl(found?.url || imageUrlFromResponse(data), normalizeBaseUrl((data as any)?.baseUrl || DEFAULT_API_BASE));
  if (!url) {
    const preview = JSON.stringify(data).slice(0, 600);
    throw new Error('接口成功但未解析到图片地址/内容，原始返回: ' + preview);
  }
  return {
    id: firstString(data?.id, data?.data?.id, data?.response?.id),
    type: 'image',
    url,
    revised_prompt: revisedPromptFromResponse(data),
  };
}

export async function askAssistant(config: DirectApiConfig, payload: { prompt: string; mode: string; refCount: number }) {
  const system = '你是一个顶级AI视觉创作导演，服务对象是“画刃”移动生图工作台。你的任务不是闲聊，而是给出有审美、有执行性的中文建议。只输出严格 JSON，不要 Markdown，不要编号，不要代码块。格式必须是 {"message":"一段80-160字中文建议","chips":["短标签","短标签","短标签","短标签"]}。message 要包含主体、构图、光影、质感、可执行改法；chips 是可点击补充词，每个不超过6个字。';
  const user = `模式：${payload.mode === 'edit' ? '参考图编辑/以图改图' : '文生图'}\n参考图数量：${payload.refCount}\n当前提示词：${payload.prompt || '无'}\n请给出下一步创作建议。`;
  const raw = await requestAssistantText(config, system, user);
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim());
  } catch {}
  const message = String(parsed?.message || raw || '先明确主体，再补充镜头、光线、材质和背景层次。').trim();
  let chips = Array.isArray(parsed?.chips) ? parsed.chips.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 4) : [];
  if (chips.length < 4) chips = [...chips, '电影光影', '主体更突出', '高级质感', '细节丰富'].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);
  return { message, chips, model: config.assistantModel };
}

export async function generateImage(config: DirectApiConfig, payload: { prompt: string; size: string; resolution?: string }) {
  const baseUrl = normalizeBaseUrl(config.apiBase);
  const px = sizeValue(payload.size, payload.resolution);
  const attempts = [
    { path: '/v1/images/generations', body: { model: config.imageModel, prompt: payload.prompt, n: 1, size: px, response_format: 'b64_json' } },
    { path: '/v1/images/generate', body: { model: config.imageModel, prompt: payload.prompt, size: px } },
  ];
  let lastErr = '';
  for (const attempt of attempts) {
    try {
      const data = await apiPost(config, attempt.path, attempt.body);
      (data as any).baseUrl = baseUrl;
      return assertImageResult(data);
    } catch (e: any) {
      lastErr = String(e?.message || e);
      if (!/404|not found|unsupported|not compatible|invalid|not support/i.test(lastErr)) throw e;
    }
  }
  throw new Error(lastErr || 'Generate API failed');
}

export async function editImage(config: DirectApiConfig, payload: { prompt: string; size: string; images: RefImage[]; resolution?: string }) {
  if (!payload.images?.length) throw new Error('参考图编辑需要先上传图片');
  const baseUrl = normalizeBaseUrl(config.apiBase);
  let lastErr = '';
  for (const ep of ['/v1/images/edits', '/v1/images/edit']) {
    const form = new FormData();
    form.append('model', config.imageModel);
    form.append('prompt', payload.prompt);
    form.append('size', sizeValue(payload.size, payload.resolution));
    form.append('n', '1');
    form.append('response_format', 'b64_json');
    payload.images.forEach((img, i) => {
      form.append('image', { uri: img.uri, name: img.name || `ref-${i + 1}.png`, type: img.mimeType || 'image/png' } as any);
    });
    try {
      const res = await fetchWithTimeout(`${baseUrl}${ep}`, { method: 'POST', headers: config.apiKey?.trim() ? { Authorization: `Bearer ${config.apiKey.trim()}` } : undefined, body: form });
      const text = await res.text();
      let json: any = {};
      try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
      if (res.ok && !json.error) {
        (json as any).baseUrl = baseUrl;
        return assertImageResult(json);
      }
      lastErr = json.error?.message || json.error || json.raw || `HTTP ${res.status}`;
      if (!/404|not found|Invalid URL/i.test(lastErr)) break;
    } catch (e: any) {
      lastErr = String(e?.message || e);
      if (!/404|not found|Invalid URL|unsupported|not compatible/i.test(lastErr)) throw e;
    }
  }
  throw new Error(lastErr || 'Edit API failed');
}

export async function optimizePrompt(config: DirectApiConfig, prompt: string) {
  const system = '你是专业AI绘图提示词优化师。把用户输入优化成适合 gpt-image-2 的中文绘图提示词。输出一段可直接用于生图的中文提示词，包含主体、构图、光影、材质、背景、画质、镜头，不解释，不编号。';
  let lastErr = '';
  for (const path of ['/v1/prompt/optimize', '/v1/prompts/optimize']) {
    try {
      const data = await apiPost(config, path, { prompt, model: config.assistantModel });
      const optimized = extractTextResponse(data);
      if (optimized) return { optimized, source: 'ai', model: config.assistantModel };
      lastErr = '优化接口未返回可用文本';
    } catch (e: any) {
      lastErr = String(e?.message || e);
      if (!/404|not found|unsupported|not compatible|invalid|not support/i.test(lastErr)) break;
    }
  }
  const raw = await requestAssistantText(config, system, prompt).catch((e: any) => {
    throw new Error(lastErr ? `${lastErr}; ${e?.message || e}` : e?.message || String(e));
  });
  return { optimized: raw || prompt, source: 'ai', model: config.assistantModel };
}

export async function health(config: DirectApiConfig) {
  const baseUrl = normalizeBaseUrl(config.apiBase);
  const attempts = [
    '/v1/health',
    '/v1/models',
  ];
  let lastErr = '';
  for (const path of attempts) {
    try {
      const res = await fetchWithTimeout(`${baseUrl}${path}`, {
        headers: config.apiKey?.trim() ? { Authorization: `Bearer ${config.apiKey.trim()}` } : undefined,
      }, HEALTH_TIMEOUT_MS);
      const text = await res.text();
      let json: any = {};
      try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
      if (!res.ok) throw new Error(json.error?.message || json.error || json.raw || `HTTP ${res.status}`);
      return { ok: true, baseUrl, imageModel: config.imageModel, optimizerModel: config.assistantModel, raw: json };
    } catch (e: any) {
      lastErr = String(e?.message || e);
    }
  }
  return { ok: false, baseUrl, imageModel: config.imageModel, optimizerModel: config.assistantModel, error: lastErr };
}
