export const DEFAULT_API_BASE = 'https://api.sharehub.club';
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2';
export const DEFAULT_ASSISTANT_MODEL = 'claude-sonnet-4-6';

export type AssistantResult = {
  message: string;
  chips: string[];
  model?: string;
};

export type GenerateResult = {
  type: 'image';
  url: string;
  revised_prompt?: string;
  elapsed?: number;
};

export type DirectApiConfig = {
  apiBase: string;
  apiKey: string;
  imageModel: string;
  assistantModel: string;
};

export type RefImage = {
  name: string;
  uri: string;
  mimeType?: string;
};

function normalizeBaseUrl(input: string) {
  return String(input || '')
    .trim()
    .replace(/\/v1\/?$/, '')
    .replace(/\/$/, '');
}

function headersFor(config: DirectApiConfig, json = true) {
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (config.apiKey?.trim()) headers.Authorization = `Bearer ${config.apiKey.trim()}`;
  return headers;
}

async function postJson<T>(config: DirectApiConfig, path: string, body: unknown): Promise<T> {
  const baseUrl = normalizeBaseUrl(config.apiBase);
  const res = await fetch(`${baseUrl}${path}`, {
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
  return json as T;
}

function parseImageResponse(raw: any, prompt: string) {
  const item = raw?.data?.[0];
  if (!item?.url && !item?.b64_json) throw new Error('未返回图片');
  return {
    type: 'image' as const,
    url: item.url || `data:image/png;base64,${item.b64_json}`,
    revised_prompt: item.revised_prompt || prompt,
  };
}

async function fileLikeFromUri(image: RefImage) {
  const response = await fetch(image.uri);
  const blob = await response.blob();
  const mimeType = image.mimeType || blob.type || 'image/png';
  return { blob, mimeType };
}

export async function askAssistant(config: DirectApiConfig, payload: { prompt: string; mode: string; refCount: number }) {
  const system = '你是辉哥专属 AI 生图工作台里的创作助手。只输出严格 JSON，不要 Markdown，不要编号，不要代码块。JSON 格式必须是 {"message":"简短中文建议","chips":["标签1","标签2","标签3"]}。chips 必须是3个短中文标签，适合点击填入提示词。';
  const user = `当前模式：${payload.mode}\n参考图数量：${payload.refCount}\n当前提示词：${payload.prompt || '用户还没写提示词'}\n请按 JSON 格式给出创作建议。`;
  const data = await postJson<any>(config, '/v1/chat/completions', {
    model: config.assistantModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.35,
    max_tokens: 500,
  });
  const raw = String(data.choices?.[0]?.message?.content || '').trim();
  let parsed: any = null;
  try {
    const jsonText = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/,'').trim();
    parsed = JSON.parse(jsonText);
  } catch {}
  const message = String(parsed?.message || raw || '请补充更多画面信息').trim();
  let chips = Array.isArray(parsed?.chips) ? parsed.chips.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 3) : [];
  if (chips.length < 3) chips = [...chips, '增强主体', '优化光影', '保留构图'].filter((v, i, a) => a.indexOf(v) === i).slice(0, 3);
  return { message, chips, model: config.assistantModel, rawFormat: parsed ? 'json' : 'text' };
}

export async function generateImage(config: DirectApiConfig, payload: { prompt: string; size: string }) {
  const data = await postJson<any>(config, '/v1/images/generations', {
    model: config.imageModel,
    prompt: payload.prompt,
    n: 1,
    size: payload.size === '16:9' ? '1792x1024' : payload.size === '9:16' ? '1024x1792' : '1024x1024',
    response_format: 'b64_json',
  });
  return parseImageResponse(data, payload.prompt);
}

export async function editImage(config: DirectApiConfig, payload: { prompt: string; size: string; images: RefImage[] }) {
  const baseUrl = normalizeBaseUrl(config.apiBase);
  const form = new FormData();
  form.append('model', config.imageModel);
  form.append('prompt', payload.prompt);
  form.append('size', payload.size === '16:9' ? '1792x1024' : payload.size === '9:16' ? '1024x1792' : '1024x1024');
  form.append('n', '1');
  form.append('response_format', 'b64_json');
  for (let i = 0; i < payload.images.length; i++) {
    const img = payload.images[i];
    const { blob, mimeType } = await fileLikeFromUri(img);
    form.append('image', blob as any, { name: img.name || `ref-${i + 1}.png`, type: mimeType } as any);
  }
  let lastErr = '';
  for (const ep of ['/v1/images/edits', '/v1/images/edit']) {
    const res = await fetch(`${baseUrl}${ep}`, {
      method: 'POST',
      headers: config.apiKey?.trim() ? { Authorization: `Bearer ${config.apiKey.trim()}` } : undefined,
      body: form,
    });
    const text = await res.text();
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (res.ok && !json.error) return parseImageResponse(json, payload.prompt);
    lastErr = json.error?.message || json.error || json.raw || `HTTP ${res.status}`;
  }
  throw new Error(lastErr || 'Edit API failed');
}

export async function optimizePrompt(config: DirectApiConfig, prompt: string) {
  const system = '你是专业AI绘图提示词优化师。把用户输入优化成适合 gpt-image-2 的中文绘图提示词。只输出优化后的提示词，不解释，不编号，不要英文标签。';
  const data = await postJson<any>(config, '/v1/chat/completions', {
    model: config.assistantModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    temperature: 0.45,
    max_tokens: 500,
  });
  return { optimized: String(data.choices?.[0]?.message?.content || prompt).trim(), source: 'ai', model: config.assistantModel };
}

export async function health(config: DirectApiConfig) {
  const baseUrl = normalizeBaseUrl(config.apiBase);
  const attempts = ['/v1/models', '/models'];
  let lastErr = '';
  for (const ep of attempts) {
    try {
      const res = await fetch(`${baseUrl}${ep}`, {
        headers: config.apiKey?.trim() ? { Authorization: `Bearer ${config.apiKey.trim()}` } : undefined,
      });
      const text = await res.text();
      let json: any = {};
      try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
      if (res.ok) return { ok: true, baseUrl, imageModel: config.imageModel, optimizerModel: config.assistantModel, raw: json };
      lastErr = json.error?.message || json.error || json.raw || `HTTP ${res.status}`;
    } catch (e: any) {
      lastErr = e?.message || String(e);
    }
  }
  throw new Error(lastErr || '连接失败');
}
