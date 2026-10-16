import { extractGeminiImageUrl } from "../src/lib/image-response";

function equal(actual: string, expected: string, name: string) {
  if (actual !== expected) {
    throw new Error(`${name}: expected ${expected}, got ${actual}`);
  }
}

const fileUri = "https://pub-example.r2.dev/images/result.jpg";
equal(
  extractGeminiImageUrl({
    candidates: [
      {
        content: {
          parts: [
            { text: fileUri },
            { fileData: { fileUri, mimeType: "image/jpeg" } },
          ],
        },
      },
    ],
  }),
  fileUri,
  "fileData camelCase",
);

equal(
  extractGeminiImageUrl({
    candidates: [
      {
        content: {
          parts: [
            { file_data: { file_uri: fileUri, mime_type: "image/jpeg" } },
          ],
        },
      },
    ],
  }),
  fileUri,
  "fileData snake_case",
);

equal(
  extractGeminiImageUrl({
    candidates: [
      {
        content: {
          parts: [{ inlineData: { data: "YWJj", mimeType: "image/png" } }],
        },
      },
    ],
  }),
  "data:image/png;base64,YWJj",
  "inlineData",
);

equal(
  extractGeminiImageUrl({
    candidates: [
      {
        content: {
          parts: [{ text: `![result](${fileUri})` }],
        },
      },
    ],
  }),
  fileUri,
  "markdown image",
);

equal(
  extractGeminiImageUrl({ candidates: [{ content: { parts: [{ text: "普通文本" }] } }] }),
  "",
  "plain text is not image",
);

console.log("Gemini image parser regression tests passed");
