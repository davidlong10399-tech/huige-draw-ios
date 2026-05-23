export const DEFAULT_API_BASE = 'https://pucoding.com';
export const DEFAULT_IMAGE_MODEL = 'flux';
export const DEFAULT_ASSISTANT_MODEL = 'gpt-4o';

export interface DirectApiConfig {
  apiBase: string;
  apiKey: string;
  imageModel: string;
  assistantModel: string;
}

export interface RefImage {
  name: string;
  uri: string;
  mimeType: string;
}

export interface GenerateResult {
  id?: string;
  url: string;
  localUri?: string;
  prompt?: string;
  revised_prompt?: string;
  elapsed?: number;
  createdAt?: number;
}

type Json = Record<string, any>;

function apiUrl(config: DirectApiConfig, path: string) {
  return config.apiBase.replace(/\/$/, '') + path;
}

async function apiPost(config: DirectApiConfig, path: string, body: Record<string, unknown>) {
  const resp = await fetch(apiUrl(config, path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + config.apiKey,
    },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!resp.ok) {
    const msg = data?.error?.message || data?.message || data?.msg || text || resp.statusText;
    throw new Error('API ' + resp.status + ': ' + msg);
  }

  return data;
}

function firstString(...values: any[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function normalizeMaybeBase64(value: string) {
  if (!value) return '';
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:image/') || value.startsWith('file:')) {
    return value;
  }
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(value) && value.length > 500) {
    return 'data:image/png;base64,' + value.replace(/\s+/g, '');
  }
  return value;
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
      value.url,
      value.image_url,
    );
  }
  return '';
}

function imageUrlFromResponse(data: Json) {
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
    data?.data?.[0]?.content?.[0]?.text,
    data?.data?.[0]?.content?.[0]?.output_text,
    data?.images?.[0]?.url,
    data?.images?.[0]?.image_url,
    data?.images?.[0]?.b64_json,
    data?.output?.[0]?.url,
    data?.output?.[0]?.image_url,
    data?.output?.[0]?.b64_json,
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
  const text = contentText(direct) || direct;
  return normalizeMaybeBase64(text);
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
  const url = imageUrlFromResponse(data);
  if (!url) {
    const preview = JSON.stringify(data).slice(0, 500);
    throw new Error('接口成功但未解析到图片地址/内容，原始返回: ' + preview);
  }
  return {
    id: firstString(data?.id, data?.data?.id, data?.response?.id),
    url,
    revised_prompt: revisedPromptFromResponse(data),
  };
}

export async function health(config: DirectApiConfig) {
  try {
    const data = await apiPost(config, '/v1/health', {});
    return data as { imageModel?: string };
  } catch {
    return { imageModel: config.imageModel };
  }
}

export async function generateImage(
  config: DirectApiConfig,
  params: { prompt: string; size: string },
): Promise<GenerateResult> {
  const data = await apiPost(config, '/v1/images/generate', {
    prompt: params.prompt,
    size: params.size,
    model: config.imageModel,
  });
  return assertImageResult(data);
}

export async function editImage(
  config: DirectApiConfig,
  params: { prompt: string; size: string; images: RefImage[] },
): Promise<GenerateResult> {
  const data = await apiPost(config, '/v1/images/edit', {
    prompt: params.prompt,
    size: params.size,
    model: config.imageModel,
    images: params.images.map((r) => ({ name: r.name, uri: r.uri, mimeType: r.mimeType })),
  });
  return assertImageResult(data);
}

export async function optimizePrompt(
  config: DirectApiConfig,
  prompt: string,
): Promise<{ optimized: string }> {
  const data = await apiPost(config, '/v1/prompt/optimize', {
    prompt,
    model: config.assistantModel,
  });
  return {
    optimized: firstString(
      data?.optimized,
      data?.result,
      data?.content,
      data?.message,
      data?.response,
      data?.response?.output_text,
      data?.response?.output?.[0]?.content?.[0]?.text,
      data?.response?.output?.[0]?.content?.[0]?.output_text,
      data?.data?.optimized,
      data?.data?.result,
      data?.data?.content,
      data?.data?.output_text,
      data?.data?.choices?.[0]?.message?.content,
      data?.data?.choices?.[0]?.text,
      data?.choices?.[0]?.message?.content,
      data?.choices?.[0]?.text,
      prompt,
    ),
  };
}

