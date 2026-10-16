import * as FileSystem from 'expo-file-system/legacy';

export const DEFAULT_API_BASE = 'https://pucoding.com';
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2.5-flare';
export const DEFAULT_ASSISTANT_MODEL = 'claude-sonnet-4-6';

// GPT Image 2.5（2026-09-08 发布）拆成两个模型 ID：
// - flare：小模型，速度快，官方推荐大多数应用的默认选择
// - sunburst：基础模型，画质与编辑精度更高，生成更慢
// 二者与 gpt-image-2 共用同一组端点，主要差异是新增 xhigh/max 画质档位与自定义尺寸规则。
export const IMAGE_MODEL_PRESETS = [
  { id: 'gpt-image-2.5-flare', label: '2.5 Flare · 快' },
  { id: 'gpt-image-2.5-sunburst', label: '2.5 Sunburst · 质' },
  { id: 'gpt-image-2', label: 'Image 2 · 旧版' },
] as const;

// gpt-image-2.5 支持 low/medium/high/xhigh/max/auto（xhigh、max 为 2.5 新增；auto 为默认）。
export const IMAGE_QUALITY_OPTIONS = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const DEFAULT_IMAGE_QUALITY: (typeof IMAGE_QUALITY_OPTIONS)[number] = 'auto';

export type AssistantResult = { message: string; chips: string[]; model?: string };
export type GenerateResult = { id?: string; type: 'image'; url: string; localUri?: string; prompt?: string; revised_prompt?: string; elapsed?: number; createdAt?: number };
// 生图协议：openai = OpenAI 兼容 Images API（GPT / Grok / 各类中转），
// gemini = Google generateContent / inlineData（gemini-*-image、imagen 系列）。
export type ImageProtocol = 'openai' | 'gemini';
export type ImageModelOption = { id: string; protocol: ImageProtocol };
export type DirectApiConfig = { apiBase: string; apiKey: string; imageModel: string; assistantModel: string; imageProtocol?: ImageProtocol };
export type RefImage = { name: string; uri: string; mimeType?: string };

// 模型品牌归类：用于主页创作工具的 GPT / Grok / Gemini 标签与配色。
export type ImageModelBrand = 'gpt' | 'grok' | 'gemini' | 'custom';
export function imageModelBrand(model?: string): ImageModelBrand {
  const m = String(model || '').toLowerCase();
  if (/gpt-image|gpt-4o|dall-e|dalle|openai/.test(m)) return 'gpt';
  if (m.includes('grok')) return 'grok';
  if (/gemini|imagen/.test(m)) return 'gemini';
  return 'custom';
}

// 未显式记录协议时按模型名推断：gemini / imagen 走 Gemini 协议，其余走 OpenAI 兼容。
export function inferImageProtocol(model?: string): ImageProtocol {
  return /gemini|imagen/i.test(String(model || '')) ? 'gemini' : 'openai';
}

// 主页模型 chip 的短标签：把长模型 ID 压成 “GPT Flare / Grok 2 Image / Gemini 2.5 Flash”。
export function imageModelChipLabel(model: string): string {
  const m = String(model || '').toLowerCase();
  if (m.includes('gpt-image')) {
    if (m.includes('flare')) return 'GPT Flare';
    if (m.includes('sunburst')) return 'GPT Sunburst';
    if (m.includes('2.5')) return 'GPT 2.5';
    if (m.includes('2')) return 'GPT Image 2';
    return 'GPT Image';
  }
  if (m.includes('grok')) {
    const v = m.match(/grok-?([0-9][\w.]*)/);
    const flavor = /image|imagine/.test(m) ? ' Image' : '';
    return `Grok ${v?.[1] || ''}${flavor}`.replace(/\s+/g, ' ').trim();
  }
  if (m.includes('gemini')) {
    const v = m.match(/gemini-?([0-9][\w.]*)/);
    const flavor = /flash/.test(m) ? ' Flash' : /pro/.test(m) ? ' Pro' : '';
    return `Gemini ${v?.[1] || ''}${flavor}`.replace(/\s+/g, ' ').trim();
  }
  if (m.includes('imagen')) {
    const v = m.match(/imagen-?([0-9][\w.]*)/);
    return `Imagen ${v?.[1] || ''}`.replace(/\s+/g, ' ').trim();
  }
  return model.length > 16 ? model.slice(0, 15) + '…' : model;
}

type Json = Record<string, any>;

// 本地 AI Studio 生图慢，默认 fetch 走系统 60s 超时会被掐断。
// 统一拉满到 300s；测试连接等轻量请求另传短超时（快速失败）。
const DEFAULT_TIMEOUT_MS = 300_000;
const HEALTH_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const { signal: _signal, ...fetchOptions } = options;
  const abortFromExternal = () => controller.abort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener('abort', abortFromExternal);
  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      if (externalSignal?.aborted) throw new Error('已取消生成。cancelled');
      throw new Error(`请求超时（已等待 ${Math.round(timeoutMs / 1000)} 秒），请检查本地服务或稍后重试。timeout`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortFromExternal);
  }
}

function normalizeBaseUrl(input: string) {
  return String(input || '').trim().replace(/\/v1\/?$/, '').replace(/\/$/, '');
}

// Gemini 官方地址常带 /v1beta 后缀，统一剥掉后由各调用方自行拼版本段。
function normalizeGeminiBaseUrl(input: string) {
  return String(input || '').trim().replace(/\/v1beta\/?$/, '').replace(/\/v1\/?$/, '').replace(/\/$/, '');
}

function headersFor(config: DirectApiConfig, json = true) {
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (config.apiKey?.trim()) headers.Authorization = `Bearer ${config.apiKey.trim()}`;
  return headers;
}

// Gemini 认证走 x-goog-api-key，不用 Bearer。
function geminiHeaders(config: { apiKey: string }, json = true) {
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (config.apiKey?.trim()) headers['x-goog-api-key'] = config.apiKey.trim();
  return headers;
}

async function readAsBase64(uri: string): Promise<string> {
  if (!uri) return '';
  if (/^data:/i.test(uri)) {
    const idx = uri.indexOf('base64,');
    return idx >= 0 ? uri.slice(idx + 7) : '';
  }
  try {
    return await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  } catch {
    return '';
  }
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

async function apiPost(config: DirectApiConfig, path: string, body: unknown, signal?: AbortSignal): Promise<Json> {
  const baseUrl = normalizeBaseUrl(config.apiBase);
  const res = await fetchWithTimeout(`${baseUrl}${path}`, {
    method: 'POST',
    headers: headersFor(config),
    body: JSON.stringify(body),
    signal,
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

// 比例 × 分辨率 → 实际像素。对齐 gpt-image-2.5 尺寸规则：
// 每条边必须是 16 的倍数、单边 ≤ 3840px、长短边比例 ≤ 3:1、
// 总像素需在 655,360–8,294,400 之间（超过 2560x1440 属实验性，仍可请求）。
// resolution: 'std'(标准 1K) | '2k' | '4k'
const SIZE_TABLE: Record<string, Record<string, string>> = {
  std: { '1:1': '1024x1024', '3:4': '864x1152', '4:3': '1152x864', '16:9': '1792x1008', '9:16': '1008x1792' },
  '2k': { '1:1': '2048x2048', '3:4': '1536x2048', '4:3': '2048x1536', '16:9': '2560x1440', '9:16': '1440x2560' },
  '4k': { '1:1': '2880x2880', '3:4': '2160x2880', '4:3': '2880x2160', '16:9': '3840x2160', '9:16': '2160x3840' },
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

// gpt-image 系列（含 2.5）走 OpenAI Images API 时：
// - 不接受 response_format，默认即返回 b64_json（asImageUrl 已兼容该形态）；
// - quality 是请求参数（auto/low/medium/high/xhigh/max），不是提示词里的形容词。
// 非 gpt-image 模型保持旧行为，不附加 quality。
function isGptImageModel(model?: string) {
  return /gpt-image/i.test(String(model || ''));
}

// Gemini 协议生图（含以图改图）：参考图以 inlineData parts 传入，
// 图片从 candidates[].content.parts[].inlineData.data（base64）解析。
async function generateImageGemini(config: DirectApiConfig, payload: { prompt: string; size: string; signal?: AbortSignal; images?: RefImage[] }): Promise<GenerateResult> {
  const baseUrl = normalizeGeminiBaseUrl(config.apiBase);
  // Imagen 使用 predict 协议；当前接口只支持文生图，参考图编辑交给 Gemini image 模型。
  if (/^imagen/i.test(config.imageModel)) {
    if (payload.images?.length) {
      throw new Error('Imagen 模型不支持当前参考图编辑协议，请选择 gemini-*-image 模型');
    }
    const body = {
      instances: [{ prompt: payload.prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: /^\d+:\d+$/.test(payload.size) ? payload.size : '1:1',
      },
    };
    const res = await fetchWithTimeout(`${baseUrl}/v1beta/models/${encodeURIComponent(config.imageModel)}:predict`, {
      method: 'POST',
      headers: geminiHeaders(config),
      body: JSON.stringify(body),
      signal: payload.signal,
    });
    const text = await res.text();
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!res.ok || json.error) throw new Error(json.error?.message || json.error || json.raw || `HTTP ${res.status}`);
    const prediction = Array.isArray(json.predictions) ? json.predictions[0] : undefined;
    const b64 = prediction?.bytesBase64Encoded || prediction?.bytes_base64_encoded || prediction?.b64_json;
    if (typeof b64 === 'string' && b64) {
      const mime = prediction?.mimeType || prediction?.mime_type || 'image/png';
      return { type: 'image', url: `data:${mime};base64,${b64}` };
    }
    (json as any).baseUrl = baseUrl;
    return assertImageResult(json);
  }

  const parts: Record<string, unknown>[] = [];
  for (const img of payload.images || []) {
    const data = await readAsBase64(img.uri);
    if (data) parts.push({ inlineData: { mimeType: img.mimeType || 'image/png', data } });
  }
  parts.push({ text: payload.prompt });
  const generationConfig: Record<string, unknown> = { responseModalities: ['TEXT', 'IMAGE'] };
  if (payload.size && /^\d+:\d+$/.test(payload.size)) {
    generationConfig.imageConfig = { aspectRatio: payload.size };
  }
  const body = { contents: [{ role: 'user', parts }], generationConfig };
  const res = await fetchWithTimeout(`${baseUrl}/v1beta/models/${encodeURIComponent(config.imageModel)}:generateContent`, {
    method: 'POST',
    headers: geminiHeaders(config),
    body: JSON.stringify(body),
    signal: payload.signal,
  });
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok || json.error) throw new Error(json.error?.message || json.error || json.raw || `HTTP ${res.status}`);
  const candidates = Array.isArray(json.candidates) ? json.candidates : [];
  for (const c of candidates) {
    const cparts = c?.content?.parts;
    if (!Array.isArray(cparts)) continue;
    for (const p of cparts) {
      const inline = p?.inlineData || p?.inline_data;
      const b64 = inline?.data;
      if (typeof b64 === 'string' && b64) {
        const mime = inline.mimeType || inline.mime_type || 'image/png';
        return { type: 'image', url: `data:${mime};base64,${b64}` };
      }
      // 部分 Gemini 中转站不回 inlineData，而是把生成图片放在 fileData.fileUri；
      // 也有实现同时在 text 中返回同一 HTTP 图片地址。
      const fileData = p?.fileData || p?.file_data;
      const fileUri = fileData?.fileUri || fileData?.file_uri;
      if (typeof fileUri === 'string' && /^https?:\/\//i.test(fileUri.trim())) {
        return { type: 'image', url: fileUri.trim() };
      }
      if (typeof p?.text === 'string' && /^https?:\/\/\S+$/i.test(p.text.trim())) {
        return { type: 'image', url: p.text.trim() };
      }
    }
  }
  // 兜底：个别中转网关会把 Gemini 结果包装成 b64_json / url 结构。
  (json as any).baseUrl = baseUrl;
  return assertImageResult(json);
}

export async function generateImage(config: DirectApiConfig, payload: { prompt: string; size: string; resolution?: string; quality?: string; signal?: AbortSignal }) {
  const protocol = config.imageProtocol || inferImageProtocol(config.imageModel);
  if (protocol === 'gemini') return generateImageGemini(config, payload);
  const baseUrl = normalizeBaseUrl(config.apiBase);
  const px = sizeValue(payload.size, payload.resolution);
  const quality = payload.quality?.trim();
  const isGrok = /grok/i.test(config.imageModel);
  // OpenAI Images 与 xAI Grok 都使用唯一标准端点 /v1/images/generations。
  // Grok 不接受 OpenAI 的 size/quality 参数，因此只发送 model/prompt/n。
  // 不再尝试非标准 /v1/images/generate，避免其 Invalid URL 覆盖真实错误。
  const body: Record<string, unknown> = isGrok
    ? { model: config.imageModel, prompt: payload.prompt, n: 1 }
    : { model: config.imageModel, prompt: payload.prompt, n: 1, size: px };
  if (!isGrok && isGptImageModel(config.imageModel) && quality) body.quality = quality;
  try {
    const data = await apiPost(config, '/v1/images/generations', body, payload.signal);
    (data as any).baseUrl = baseUrl;
    return assertImageResult(data);
  } catch (e: any) {
    const message = String(e?.message || e);
    throw new Error(`${message}（POST /v1/images/generations，模型 ${config.imageModel}）`);
  }
}

export async function editImage(config: DirectApiConfig, payload: { prompt: string; size: string; images: RefImage[]; resolution?: string; quality?: string; signal?: AbortSignal }) {
  if (!payload.images?.length) throw new Error('参考图编辑需要先上传图片');
  const protocol = config.imageProtocol || inferImageProtocol(config.imageModel);
  if (protocol === 'gemini') return generateImageGemini(config, payload);
  const baseUrl = normalizeBaseUrl(config.apiBase);
  const quality = payload.quality?.trim();
  let lastErr = '';
  for (const ep of ['/v1/images/edits', '/v1/images/edit']) {
    const form = new FormData();
    form.append('model', config.imageModel);
    form.append('prompt', payload.prompt);
    form.append('size', sizeValue(payload.size, payload.resolution));
    form.append('n', '1');
    if (isGptImageModel(config.imageModel) && quality) form.append('quality', quality);
    payload.images.forEach((img, i) => {
      form.append('image', { uri: img.uri, name: img.name || `ref-${i + 1}.png`, type: img.mimeType || 'image/png' } as any);
    });
    try {
      const res = await fetchWithTimeout(`${baseUrl}${ep}`, { method: 'POST', headers: config.apiKey?.trim() ? { Authorization: `Bearer ${config.apiKey.trim()}` } : undefined, body: form, signal: payload.signal });
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
  const system = '你是专业AI绘图提示词优化师。把用户输入优化成适合 GPT Image 系列（gpt-image-2.5 / gpt-image-2）的中文绘图提示词。输出一段可直接用于生图的中文提示词，包含主体、构图、光影、材质、背景、画质、镜头，不解释，不编号。';
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

// 拉取可用模型列表：
// - openai 协议：GET {base}/v1/models（GPT / Grok / 中转网关通用）
// - gemini 协议：GET {base}/v1beta/models，按名称与能力过滤出图像模型
const IMAGE_LIKE_MODEL = /image|imagen|dall-e|dalle|flux|stable-diffusion|sdxl|sd3|midjourney|recraft|ideogram|seedream|seededit|cogview|wanx|kolors|hidream|photon|banana/i;
const MODELS_FETCH_TIMEOUT_MS = 60_000;

export async function fetchImageModels(config: { apiBase: string; apiKey: string; protocol?: ImageProtocol }): Promise<string[]> {
  const protocol = config.protocol || 'openai';
  if (protocol === 'gemini') {
    const baseUrl = normalizeGeminiBaseUrl(config.apiBase);
    const res = await fetchWithTimeout(`${baseUrl}/v1beta/models?pageSize=1000`, {
      headers: geminiHeaders(config, false),
    }, MODELS_FETCH_TIMEOUT_MS);
    const text = await res.text();
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!res.ok || json.error) throw new Error(json.error?.message || json.error || json.raw || `HTTP ${res.status}`);
    const models = Array.isArray(json.models) ? json.models : [];
    const ids: string[] = models
      .map((m: any) => {
        const id = String(m?.name || '').replace(/^models\//, '').trim();
        const methods = Array.isArray(m?.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
        return { id, imageLike: IMAGE_LIKE_MODEL.test(id) || methods.includes('predict') };
      })
      .filter((x: { id: string; imageLike: boolean }) => x.id && x.imageLike)
      .map((x: { id: string }) => x.id);
    return Array.from(new Set(ids)).sort();
  }
  const baseUrl = normalizeBaseUrl(config.apiBase);
  const res = await fetchWithTimeout(`${baseUrl}/v1/models`, {
    headers: headersFor(config as DirectApiConfig, false),
  }, MODELS_FETCH_TIMEOUT_MS);
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok || json.error) throw new Error(json.error?.message || json.error || json.raw || `HTTP ${res.status}`);
  const pool = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : [];
  const ids: string[] = pool
    .map((m: any) => (typeof m === 'string' ? m : String(m?.id || m?.name || '').replace(/^models\//, '').trim()))
    .filter(Boolean);
  // 图像相关模型排前面，纯文本模型靠后，避免长列表里找不到生图模型。
  return Array.from(new Set(ids))
    .sort((a, b) => Number(IMAGE_LIKE_MODEL.test(b)) - Number(IMAGE_LIKE_MODEL.test(a)) || a.localeCompare(b))
    .slice(0, 120);
}

export async function health(config: DirectApiConfig) {
  const protocol = config.imageProtocol || inferImageProtocol(config.imageModel);
  const attempts = protocol === 'gemini'
    ? [{ base: normalizeGeminiBaseUrl(config.apiBase), path: '/v1beta/models', headers: geminiHeaders(config, false) }]
    : [
        { base: normalizeBaseUrl(config.apiBase), path: '/v1/health', headers: config.apiKey?.trim() ? { Authorization: `Bearer ${config.apiKey.trim()}` } as Record<string, string> : {} },
        { base: normalizeBaseUrl(config.apiBase), path: '/v1/models', headers: config.apiKey?.trim() ? { Authorization: `Bearer ${config.apiKey.trim()}` } as Record<string, string> : {} },
      ];
  let lastErr = '';
  for (const attempt of attempts) {
    try {
      const res = await fetchWithTimeout(`${attempt.base}${attempt.path}`, {
        headers: attempt.headers,
      }, HEALTH_TIMEOUT_MS);
      const text = await res.text();
      let json: any = {};
      try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
      if (!res.ok) throw new Error(json.error?.message || json.error || json.raw || `HTTP ${res.status}`);
      return { ok: true, baseUrl: attempt.base, imageModel: config.imageModel, optimizerModel: config.assistantModel, raw: json };
    } catch (e: any) {
      lastErr = String(e?.message || e);
    }
  }
  return { ok: false, baseUrl: attempts[0].base, imageModel: config.imageModel, optimizerModel: config.assistantModel, error: lastErr };
}
