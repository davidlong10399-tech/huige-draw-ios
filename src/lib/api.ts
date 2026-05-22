export const DEFAULT_API_BASE = 'https://pucoding.com';
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2';
export const DEFAULT_ASSISTANT_MODEL = 'claude-sonnet-4-6';

export type AssistantResult = { message: string; chips: string[]; model?: string };
export type GenerateResult = { id?: string; type: 'image'; url: string; localUri?: string; prompt?: string; revised_prompt?: string; elapsed?: number; createdAt?: number };
export type DirectApiConfig = { apiBase: string; apiKey: string; imageModel: string; assistantModel: string };
export type RefImage = { name: string; uri: string; mimeType?: string };

function normalizeBaseUrl(input: string) {
  return String(input || '').trim().replace(/\/v1\/?$/, '').replace(/\/$/, '');
}
function headersFor(config: DirectApiConfig, json = true) {
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (config.apiKey?.trim()) headers.Authorization = `Bearer ${config.apiKey.trim()}`;
  return headers;
}
async function postJson<T>(config: DirectApiConfig, path: string, body: unknown): Promise<T> {
  const baseUrl = normalizeBaseUrl(config.apiBase);
  const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: headersFor(config), body: JSON.stringify(body) });
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok || json.error) throw new Error(json.error?.message || json.error || json.raw || `HTTP ${res.status}`);
  return json as T;
}
function parseImageResponse(raw: any, prompt: string) {
  const item = raw?.data?.[0];
  if (!item?.url && !item?.b64_json) throw new Error('未返回图片');
  return { type: 'image' as const, url: item.url || `data:image/png;base64,${item.b64_json}`, revised_prompt: item.revised_prompt || prompt, prompt };
}
function sizeValue(size: string) {
  return size === '16:9' ? '1792x1024' : size === '9:16' ? '1024x1792' : '1024x1024';
}

export async function askAssistant(config: DirectApiConfig, payload: { prompt: string; mode: string; refCount: number }) {
  const system = '你是一个顶级 AI 视觉创作导演，服务对象是“辉哥 Draw”移动生图工作台。你的任务不是闲聊，而是像截图里的专业创作助手一样：给出有审美、有执行性的中文建议。只输出严格 JSON，不要 Markdown，不要编号，不要代码块。格式必须是 {"message":"一段80-160字中文建议","chips":["短标签1","短标签2","短标签3","短标签4"]}。message 要包含主体、构图、光影、质感、可执行改法；chips 是可点击补充词，每个不超过8个字。';
  const user = `模式：${payload.mode === 'edit' ? '参考图编辑/以图改图' : '文生图'}\n参考图数量：${payload.refCount}\n当前提示词：${payload.prompt || '空'}\n请给出下一步创作建议。`;
  const data = await postJson<any>(config, '/v1/chat/completions', { model: config.assistantModel, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.45, max_tokens: 700 });
  const raw = String(data.choices?.[0]?.message?.content || '').trim();
  let parsed: any = null;
  try { parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim()); } catch {}
  const message = String(parsed?.message || raw || '先明确主体，再补充镜头、光线、材质和背景层次。').trim();
  let chips = Array.isArray(parsed?.chips) ? parsed.chips.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 4) : [];
  if (chips.length < 4) chips = [...chips, '电影光影', '主体更突出', '高级质感', '细节丰富'].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);
  return { message, chips, model: config.assistantModel };
}

export async function generateImage(config: DirectApiConfig, payload: { prompt: string; size: string }) {
  const data = await postJson<any>(config, '/v1/images/generations', { model: config.imageModel, prompt: payload.prompt, n: 1, size: sizeValue(payload.size), response_format: 'b64_json' });
  return parseImageResponse(data, payload.prompt);
}

export async function editImage(config: DirectApiConfig, payload: { prompt: string; size: string; images: RefImage[] }) {
  if (!payload.images?.length) throw new Error('参考图编辑需要先上传图片');
  const baseUrl = normalizeBaseUrl(config.apiBase);
  let lastErr = '';
  for (const ep of ['/v1/images/edits', '/v1/images/edit']) {
    const form = new FormData();
    form.append('model', config.imageModel);
    form.append('prompt', payload.prompt);
    form.append('size', sizeValue(payload.size));
    form.append('n', '1');
    form.append('response_format', 'b64_json');
    payload.images.forEach((img, i) => {
      form.append('image', { uri: img.uri, name: img.name || `ref-${i + 1}.png`, type: img.mimeType || 'image/png' } as any);
    });
    const res = await fetch(`${baseUrl}${ep}`, { method: 'POST', headers: config.apiKey?.trim() ? { Authorization: `Bearer ${config.apiKey.trim()}` } : undefined, body: form });
    const text = await res.text();
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (res.ok && !json.error) return parseImageResponse(json, payload.prompt);
    lastErr = json.error?.message || json.error || json.raw || `HTTP ${res.status}`;
    if (!/404|not found|Invalid URL/i.test(lastErr)) break;
  }
  throw new Error(lastErr || 'Edit API failed');
}

export async function optimizePrompt(config: DirectApiConfig, prompt: string) {
  const system = '你是专业AI绘图提示词优化师。把用户输入优化成适合 gpt-image-2 的中文绘图提示词。输出一段可直接用于生图的中文提示词，包含主体、构图、光影、材质、背景、画幅/镜头，不解释，不编号。';
  const data = await postJson<any>(config, '/v1/chat/completions', { model: config.assistantModel, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], temperature: 0.45, max_tokens: 700 });
  return { optimized: String(data.choices?.[0]?.message?.content || prompt).trim(), source: 'ai', model: config.assistantModel };
}

export async function health(config: DirectApiConfig) {
  const baseUrl = normalizeBaseUrl(config.apiBase);
  const res = await fetch(`${baseUrl}/v1/models`, { headers: config.apiKey?.trim() ? { Authorization: `Bearer ${config.apiKey.trim()}` } : undefined });
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(json.error?.message || json.error || json.raw || `HTTP ${res.status}`);
  return { ok: true, baseUrl, imageModel: config.imageModel, optimizerModel: config.assistantModel, raw: json };
}
