type JsonRecord = Record<string, any>;

export function extractGeminiImageUrl(data: JsonRecord): string {
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const parts = candidates.flatMap((candidate: any) =>
    Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [],
  );

  for (const part of parts) {
    const inline = part?.inlineData || part?.inline_data;
    if (typeof inline?.data === "string" && inline.data) {
      const mime = inline.mimeType || inline.mime_type || "image/png";
      if (mime.startsWith("image/")) {
        return `data:${mime};base64,${inline.data}`;
      }
    }

    const file = part?.fileData || part?.file_data;
    const uri = file?.fileUri || file?.file_uri;
    const mime = file?.mimeType || file?.mime_type;
    if (
      typeof uri === "string" &&
      /^https?:\/\//i.test(uri.trim()) &&
      (!mime || mime.startsWith("image/"))
    ) {
      return uri.trim();
    }
  }

  for (const part of parts) {
    if (typeof part?.text !== "string") continue;
    const text = part.text.trim();
    const markdown = text.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/i);
    if (markdown) return markdown[1];
    if (/^https?:\/\/\S+$/i.test(text)) return text;
  }

  return "";
}
