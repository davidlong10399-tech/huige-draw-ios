export const DEFAULT_API_BASE = 'http://192.168.2.104:8848';

export type AssistantResult = {
  message: string;
  chips: string[];
  model?: string;
};

export type GenerateResult = {
  type: 'image';
  url: string;
  revised_prompt?: string;
  localFile?: string;
  elapsed?: number;
};

async function postJson<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
  return json as T;
}

export function askAssistant(baseUrl: string, payload: { prompt: string; mode: string; refCount: number }) {
  return postJson<AssistantResult>(baseUrl, '/api/assistant', payload);
}

export function generateImage(baseUrl: string, payload: { prompt: string; size: string }) {
  return postJson<GenerateResult>(baseUrl, '/api/generate', payload);
}

export function editImage(baseUrl: string, payload: { prompt: string; size: string; images: { name: string; dataUrl: string }[] }) {
  return postJson<GenerateResult>(baseUrl, '/api/edit', payload);
}

export async function health(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/health`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return json;
}
