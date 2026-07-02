import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import { useKeepAwake } from "expo-keep-awake";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import {
  askAssistant,
  editImage,
  generateImage,
  health,
  DEFAULT_API_BASE,
  DEFAULT_ASSISTANT_MODEL,
  DEFAULT_IMAGE_MODEL,
  DirectApiConfig,
  GenerateResult,
  optimizePrompt,
  RefImage,
} from "./src/lib/api";

declare const process: { env: Record<string, string | undefined> };

type Mode = "generate" | "edit";
type Tab = "create" | "gallery" | "profile";
type SavedConfig = {
  imageApiBase?: string;
  imageApiKey?: string;
  imageModel?: string;
  textApiBase?: string;
  textApiKey?: string;
  textModel?: string;
  showSettings?: boolean;
  apiBase?: string;
  apiKey?: string;
  assistantModel?: string;
  promptPlazaUrl?: string;
};

const CONFIG_KEY = "huige-draw-direct-config-v4";
const LEGACY_CONFIG_KEY = "huige-draw-direct-config-v3";
const HISTORY_KEY = "huige-draw-history-v3";
const MAX_HISTORY = 50;
const DEFAULT_DIRECT_API_BASE =
  process.env.EXPO_PUBLIC_HUIGE_API_BASE || "https://ai.beehears.com/v1";
const DEFAULT_DIRECT_API_KEY = process.env.EXPO_PUBLIC_HUIGE_API_KEY || "";
const DEFAULT_IMAGE_API_BASE =
  process.env.EXPO_PUBLIC_HUIGE_IMAGE_API_BASE || DEFAULT_DIRECT_API_BASE;
const DEFAULT_IMAGE_API_KEY =
  process.env.EXPO_PUBLIC_HUIGE_IMAGE_API_KEY || DEFAULT_DIRECT_API_KEY;
const DEFAULT_TEXT_API_BASE =
  process.env.EXPO_PUBLIC_HUIGE_TEXT_API_BASE || DEFAULT_DIRECT_API_BASE;
const DEFAULT_TEXT_API_KEY =
  process.env.EXPO_PUBLIC_HUIGE_TEXT_API_KEY || DEFAULT_DIRECT_API_KEY;
const DEFAULT_IMAGE_MODEL_VALUE =
  process.env.EXPO_PUBLIC_HUIGE_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
const DEFAULT_TEXT_MODEL_VALUE =
  process.env.EXPO_PUBLIC_HUIGE_TEXT_MODEL || DEFAULT_ASSISTANT_MODEL;
const DEFAULT_PROMPT_PLAZA_URL =
  process.env.EXPO_PUBLIC_HUIGE_PROMPT_PLAZA_URL ||
  "https://evolink.ai/zh/gpt-image-2-prompts";
const stylesList = [
  "商业海报",
  "真实自拍",
  "电影感",
  "真实摄影",
  "国潮",
  "产品摄影",
  "赛博朋克",
];
const stylePrompts: Record<string, string> = {
  商业海报: "商业海报设计，强视觉冲击，高级排版，真实光影",
  真实自拍: "真实手机自拍照，前置摄像头视角，自然肤质与毛孔细节，随手抓拍的生活感，轻微噪点与真实光线，非专业摆拍，朋友圈日常质感",
  电影感: "电影感构图，戏剧化光影，浅景深，色彩分级",
  真实摄影: "真实摄影，自然光影，细节丰富，高分辨率",
  国潮: "国潮东方美学，红金色调，精致纹样",
  产品摄影: "高端产品摄影，棚拍灯光，极简背景",
  赛博朋克: "雨夜霓虹，赛博朋克城市，湿润地面反光，高细节",
};

const styleShowcase = [
  {
    name: "商业海报",
    title: "商业",
    sub: "主图广告",
    icon: "storefront-outline",
    accent: "#F6C96D",
  },
  {
    name: "真实自拍",
    title: "自拍",
    sub: "生活质感",
    icon: "camera-outline",
    accent: "#A78BFA",
  },
  {
    name: "电影感",
    title: "电影",
    sub: "光影叙事",
    icon: "film-outline",
    accent: "#60A5FA",
  },
  {
    name: "真实摄影",
    title: "摄影",
    sub: "自然真实",
    icon: "aperture-outline",
    accent: "#5EEAD4",
  },
  {
    name: "国潮",
    title: "国潮",
    sub: "东方纹样",
    icon: "color-palette-outline",
    accent: "#FB7185",
  },
  {
    name: "产品摄影",
    title: "产品",
    sub: "棚拍质感",
    icon: "cube-outline",
    accent: "#93C5FD",
  },
  {
    name: "赛博朋克",
    title: "赛博",
    sub: "霓虹未来",
    icon: "flash-outline",
    accent: "#C084FC",
  },
] as const;

const sizeOptions = [
  { key: "1:1", label: "方图" },
  { key: "3:4", label: "竖图" },
  { key: "4:3", label: "横图" },
  { key: "9:16", label: "手机" },
  { key: "16:9", label: "壁纸" },
] as const;

const resolutionOptions = [
  { key: "std", label: "标准" },
  { key: "2k", label: "2K" },
  { key: "4k", label: "4K" },
] as const;

const promptPlaza = [
  {
    tag: "电商",
    title: "618 高级产品主图",
    prompt:
      "一张 618 足浴盆电商主图，白色产品置于明亮浴室环境，干净高级，暖色灯光，商业摄影质感，主体突出，背景整洁，适合手机端详情页首图。",
    style: "商业海报",
  },
  {
    tag: "真实",
    title: "朋友圈真实自拍",
    prompt:
      "真实手机自拍照，前置摄像头视角，自然肤质，生活化室内光线，人物轻松自然，背景略微虚化，随手抓拍但构图舒服。",
    style: "真实自拍",
  },
  {
    tag: "海报",
    title: "电影感活动海报",
    prompt:
      "电影感活动主视觉海报，主体居中，戏剧化侧逆光，深色背景，高级质感，文字区域留白，画面有强烈层次和商业大片氛围。",
    style: "电影感",
  },
  {
    tag: "空间",
    title: "高级浴室空间图",
    prompt:
      "现代明亮浴室空间，浅色瓷砖，干净台面，柔和自然光，产品融入真实使用场景，画面高级、整洁、温暖，真实摄影质感。",
    style: "真实摄影",
  },
  {
    tag: "潮流",
    title: "霓虹赛博场景",
    prompt:
      "雨夜霓虹城市街头，湿润地面反光，赛博朋克氛围，主体被青紫色灯光勾勒，高细节，高对比，电影镜头感。",
    style: "赛博朋克",
  },
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nonEmpty(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function sameBaseUrl(a: string, b: string) {
  return a.trim().replace(/\/v1\/?$/, "").replace(/\/$/, "") ===
    b.trim().replace(/\/v1\/?$/, "").replace(/\/$/, "");
}

function shouldReplaceOldDefaultBase(savedBase: string, savedKey: string) {
  return !savedBase || (!savedKey && sameBaseUrl(savedBase, DEFAULT_API_BASE));
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function makeUploadableRef(
  asset: { uri: string; fileName?: string | null; mimeType?: string | null },
  index = 0,
): Promise<RefImage> {
  const converted = await ImageManipulator.manipulateAsync(asset.uri, [], {
    compress: 0.92,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  const baseName =
    asset.fileName?.replace(/\.[^.]+$/, "") || `ref-${Date.now()}-${index}`;
  return {
    name: `${baseName}.jpg`,
    uri: converted.uri,
    mimeType: "image/jpeg",
  };
}

async function persistImage(result: GenerateResult) {
  const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!baseDir) return result;
  const filename = `huaren-${result.id || makeId()}.png`;
  const localUri = `${baseDir}${filename}`;
  if (result.url.startsWith("data:image/")) {
    const base64 = result.url.split(",")[1] || "";
    await FileSystem.writeAsStringAsync(localUri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } else if (/^https?:/i.test(result.url)) {
    const response = await fetch(result.url);
    if (!response.ok) throw new Error(`图片下载失败 HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);
    await FileSystem.writeAsStringAsync(localUri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } else if (result.url.startsWith("file:")) {
    if (result.url !== localUri)
      await FileSystem.copyAsync({ from: result.url, to: localUri }).catch(
        () => {},
      );
  } else {
    return result;
  }
  return { ...result, localUri, url: localUri };
}

async function filterExistingResults(items: GenerateResult[]) {
  const next: GenerateResult[] = [];
  for (const item of items || []) {
    if (!item) continue;
    if (item.localUri) {
      try {
        const info = await FileSystem.getInfoAsync(item.localUri);
        if (info.exists) {
          next.push({ ...item, url: item.localUri });
          continue;
        }
      } catch {}
    }
    if (
      typeof item.url === "string" &&
      (item.url.startsWith("data:image/") || /^https?:/i.test(item.url))
    ) {
      next.push(item);
    }
  }
  return next.slice(0, MAX_HISTORY);
}

export default function App() {
  const { width: viewportWidth } = useWindowDimensions();
  const pageWidth = Math.max(
    280,
    Math.min(viewportWidth - (Platform.OS === "web" ? 120 : 40), 520),
  );
  const pageLeft = 20;
  const [hydrated, setHydrated] = useState(false);
  const [imageApiBase, setImageApiBase] = useState(DEFAULT_IMAGE_API_BASE);
  const [imageApiKey, setImageApiKey] = useState(DEFAULT_IMAGE_API_KEY);
  const [imageModel, setImageModel] = useState(DEFAULT_IMAGE_MODEL_VALUE);
  const [textApiBase, setTextApiBase] = useState(DEFAULT_TEXT_API_BASE);
  const [textApiKey, setTextApiKey] = useState(DEFAULT_TEXT_API_KEY);
  const [textModel, setTextModel] = useState(DEFAULT_TEXT_MODEL_VALUE);
  const [promptPlazaUrl, setPromptPlazaUrl] = useState(
    DEFAULT_PROMPT_PLAZA_URL,
  );
  const [showSettings, setShowSettings] = useState(false);
  const [expandedConfig, setExpandedConfig] = useState(false);
  const [expandedImageSettings, setExpandedImageSettings] = useState(false);
  const [expandedTextSettings, setExpandedTextSettings] = useState(false);
  const [expandedPlazaSettings, setExpandedPlazaSettings] = useState(false);
  const settingsLayoutInitialized = useRef(false);
  const [tab, setTab] = useState<Tab>("create");
  const [connected, setConnected] = useState("请填写 API Key 后测试连接");
  const [mode, setMode] = useState<Mode>("generate");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1:1");
  const [resolution, setResolution] = useState("std");
  const [style, setStyle] = useState("商业海报");
  const [refs, setRefs] = useState<RefImage[]>([]);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [optimizing, setOptimizing] = useState(false);
  const [assisting, setAssisting] = useState(false);
  const [assistantMsg, setAssistantMsg] = useState("");
  const [assistantChips, setAssistantChips] = useState<string[]>([]);
  const [results, setResults] = useState<GenerateResult[]>([]);
  const [selected, setSelected] = useState<GenerateResult | null>(null);
  const [showPromptPlaza, setShowPromptPlaza] = useState(false);
  const [showGenerationPage, setShowGenerationPage] = useState(false);
  const [galleryFilter, setGalleryFilter] = useState<"all" | "recent" | "fast">("all");
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const generateAbortRef = useRef<AbortController | null>(null);

  const imageConfig: DirectApiConfig = useMemo(
    () => ({
      apiBase: imageApiBase,
      apiKey: imageApiKey,
      imageModel,
      assistantModel: textModel,
    }),
    [imageApiBase, imageApiKey, imageModel, textModel],
  );
  const textConfig: DirectApiConfig = useMemo(
    () => ({
      apiBase: textApiBase,
      apiKey: textApiKey,
      imageModel,
      assistantModel: textModel,
    }),
    [textApiBase, textApiKey, imageModel, textModel],
  );
  const fullPrompt = useMemo(
    () => [prompt.trim(), stylePrompts[style] || ""].filter(Boolean).join("，"),
    [prompt, style],
  );
  const maskedImageKey = imageApiKey
    ? `${imageApiKey.slice(0, 6)}****${imageApiKey.slice(-4)}`
    : "未填写";
  const maskedTextKey = textApiKey
    ? `${textApiKey.slice(0, 6)}****${textApiKey.slice(-4)}`
    : "未填写";
  const editBlocked = mode === "edit" && refs.length === 0;
  const generateDisabled = generating || optimizing || editBlocked || !hydrated;
  const activeTask = generating || optimizing;
  const imageConfigured =
    !!imageApiBase.trim() && !!imageApiKey.trim() && !!imageModel.trim();
  const textConfigured =
    !!textApiBase.trim() && !!textApiKey.trim() && !!textModel.trim();
  const imageConfigSummary = imageConfigured
    ? `${imageApiBase.replace(/^https?:\/\//, "")} · ${imageModel} · ${maskedImageKey}`
    : "文生图 / 以图改图，待配置";
  const textConfigSummary = textConfigured
    ? `${textApiBase.replace(/^https?:\/\//, "")} · ${textModel} · ${maskedTextKey}`
    : "AI 提示词优化，待配置";
  const galleryResults = useMemo(() => {
    if (galleryFilter === "recent") return results.slice(0, 12);
    if (galleryFilter === "fast") {
      return results.filter((r) => (r.elapsed || 0) > 0 && (r.elapsed || 999) <= 30);
    }
    return results;
  }, [galleryFilter, results]);
  useKeepAwake(activeTask ? "huaren-active-task" : undefined);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const saved =
          (await AsyncStorage.getItem(CONFIG_KEY)) ||
          (await AsyncStorage.getItem(LEGACY_CONFIG_KEY));
        if (saved && alive) {
          const c = JSON.parse(saved) as SavedConfig;
          const legacyBase = nonEmpty(c.apiBase);
          const legacyKey = nonEmpty(c.apiKey);
          const savedImageBase = nonEmpty(c.imageApiBase) || legacyBase;
          const savedImageKey = nonEmpty(c.imageApiKey) || legacyKey;
          const savedTextBase = nonEmpty(c.textApiBase) || legacyBase;
          const savedTextKey = nonEmpty(c.textApiKey) || legacyKey;
          setImageApiBase(
            shouldReplaceOldDefaultBase(savedImageBase, savedImageKey)
              ? DEFAULT_IMAGE_API_BASE
              : savedImageBase,
          );
          setImageApiKey(savedImageKey || DEFAULT_IMAGE_API_KEY);
          setImageModel(c.imageModel || DEFAULT_IMAGE_MODEL_VALUE);
          setTextApiBase(
            shouldReplaceOldDefaultBase(savedTextBase, savedTextKey)
              ? DEFAULT_TEXT_API_BASE
              : savedTextBase,
          );
          setTextApiKey(savedTextKey || DEFAULT_TEXT_API_KEY);
          setTextModel(
            c.textModel || c.assistantModel || DEFAULT_TEXT_MODEL_VALUE,
          );
          setPromptPlazaUrl(c.promptPlazaUrl || DEFAULT_PROMPT_PLAZA_URL);
          setShowSettings(c.showSettings ?? false);
        }
        const h = await AsyncStorage.getItem(HISTORY_KEY);
        if (h && alive) {
          const parsed = JSON.parse(h) as GenerateResult[];
          const existing = await filterExistingResults(parsed);
          if (alive) setResults(existing);
        }
      } catch {
      } finally {
        if (alive) setHydrated(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || settingsLayoutInitialized.current) return;
    settingsLayoutInitialized.current = true;
    setExpandedConfig(!imageConfigured || !textConfigured);
    setExpandedImageSettings(!imageConfigured);
    setExpandedTextSettings(imageConfigured && !textConfigured);
  }, [hydrated, imageConfigured, textConfigured]);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(
      CONFIG_KEY,
      JSON.stringify({
        imageApiBase,
        imageApiKey,
        imageModel,
        textApiBase,
        textApiKey,
        textModel,
        promptPlazaUrl,
        showSettings,
      }),
    ).catch(() => {});
  }, [
    hydrated,
    imageApiBase,
    imageApiKey,
    imageModel,
    textApiBase,
    textApiKey,
    textModel,
    promptPlazaUrl,
    showSettings,
  ]);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(results.slice(0, MAX_HISTORY)),
    ).catch(() => {});
  }, [hydrated, results]);

  useEffect(
    () => () => {
      if (progressTimer.current) clearInterval(progressTimer.current);
      generateAbortRef.current?.abort();
    },
    [],
  );

  function startProgress(label: string) {
    setProgress(0.08);
    setProgressText(label);
    if (progressTimer.current) clearInterval(progressTimer.current);
    progressTimer.current = setInterval(() => {
      setProgress((p) =>
        Math.min(0.92, p + (p < 0.45 ? 0.06 : p < 0.75 ? 0.025 : 0.01)),
      );
    }, 900);
  }

  function stopProgress(label = "") {
    if (progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
    setProgress(0);
    setProgressText(label);
  }

  function friendlyErrorMessage(error: any) {
    const message = error?.message || String(error);
    if (/请求超时（已等待/.test(message)) {
      return message + "（本地生图较慢属正常，可保持前台等待或重试）";
    }
    if (/504|timeout|timed out|Gateway Timeout/i.test(message)) {
      return "服务商超时(504)。这不是 App 卡住，请稍后重试或切换中转站/模型。";
    }
    if (/Network request failed/i.test(message)) {
      return "网络请求失败。请保持前台/网络稳定后重试。";
    }
    return message;
  }

  async function finishProgress(label: string) {
    if (progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
    setProgressText(label);
    setProgress(1);
    await sleep(450);
    stopProgress("");
  }

  const checkHealth = useCallback(async () => {
    if (!imageApiKey.trim()) {
      setConnected("请先填写生图 API Key");
      return;
    }
    setConnected("测试生图连接中...");
    try {
      const h = await health(imageConfig);
      if (h.ok) setConnected(`生图接口正常 · ${h.imageModel || imageModel}`);
      else setConnected(`生图连接失败: ${h.error || "接口无响应"}`);
    } catch (e: any) {
      setConnected(`生图连接失败: ${e.message}`);
    }
  }, [imageApiKey, imageConfig, imageModel]);

  async function pickImages() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted)
      return Alert.alert("需要相册权限", "请选择参考图用于图像编辑。");
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.92,
    });
    if (r.canceled) return;
    const next = [...refs];
    for (const asset of r.assets) {
      if (next.length >= 4) break;
      if (asset.uri) next.push(await makeUploadableRef(asset, next.length));
    }
    setRefs(next);
    if (next.length) setMode("edit");
  }

  async function runOptimize() {
    if (!textApiKey.trim())
      return Alert.alert(
        "缺少文本 API Key",
        "请先在设置里填写提示词优化 API Key。",
      );
    if (!prompt.trim()) return Alert.alert("先输入提示词");
    setOptimizing(true);
    startProgress("正在优化提示词");
    try {
      const r = await optimizePrompt(textConfig, prompt);
      setPrompt(r.optimized);
      await finishProgress("优化完成");
    } catch (e: any) {
      stopProgress();
      Alert.alert("优化失败", friendlyErrorMessage(e));
    } finally {
      setOptimizing(false);
    }
  }

  async function runAssistant() {
    if (!textApiKey.trim())
      return Alert.alert("缺少文本 API Key", "请先在设置里填写文本接口 API Key。");
    setAssisting(true);
    try {
      const r = await askAssistant(textConfig, {
        prompt,
        mode,
        refCount: refs.length,
      });
      setAssistantMsg(r.message);
      setAssistantChips(r.chips || []);
    } catch (e: any) {
      Alert.alert("助手失败", friendlyErrorMessage(e));
    } finally {
      setAssisting(false);
    }
  }

  function applyChip(chip: string) {
    setPrompt((p) => {
      const t = p.trim();
      if (!t) return chip;
      return /[，,、]$/.test(t) ? t + chip : t + "，" + chip;
    });
  }

  function applyPromptPreset(item: (typeof promptPlaza)[number]) {
    setPrompt(item.prompt);
    if (item.style) setStyle(item.style);
    setShowPromptPlaza(false);
    setTab("create");
  }

  async function openPromptPlazaUrl() {
    const url = promptPlazaUrl.trim();
    if (!url) return Alert.alert("未配置提示词广场", "可以先使用内置精选，也可以在设置里填外部提示词广场地址。");
    const canOpen = await Linking.canOpenURL(url).catch(() => false);
    if (!canOpen) return Alert.alert("无法打开", "请检查提示词广场地址是否正确。");
    await Linking.openURL(url);
  }

  function cancelGenerate() {
    if (!generating) return;
    generateAbortRef.current?.abort();
    setProgressText("正在取消生成...");
  }

  async function runGenerate() {
    if (!imageApiKey.trim())
      return Alert.alert("缺少生图 API Key", "请先在设置里填写生图 API Key。");
    if (!fullPrompt.trim()) return Alert.alert("先输入提示词");
    if (mode === "edit" && !refs.length)
      return Alert.alert(
        "缺少参考图",
        '以图改图必须先上传参考图。请先点"上传参考图"，或切回"文生图"。',
      );
    const controller = new AbortController();
    generateAbortRef.current = controller;
    setShowGenerationPage(true);
    setTab("create");
    setGenerating(true);
    startProgress(mode === "edit" ? "正在以图改图" : "正在生成图片");
    try {
      const started = Date.now();
      const raw =
        mode === "edit"
          ? await editImage(imageConfig, {
              prompt: fullPrompt,
              size,
              resolution,
              images: refs,
              signal: controller.signal,
            })
          : await generateImage(imageConfig, { prompt: fullPrompt, size, resolution, signal: controller.signal });
      const item: GenerateResult = {
        ...raw,
        id: makeId(),
        prompt: fullPrompt,
        elapsed: Math.round((Date.now() - started) / 1000),
        createdAt: Date.now(),
      };
      let saved: GenerateResult = item;
      try {
        saved = await persistImage(item);
      } catch (saveError: any) {
        Alert.alert(
          "生成成功，但本地保存失败",
          saveError?.message || String(saveError),
        );
      }
      setResults((prev) => [saved, ...prev].slice(0, MAX_HISTORY));
      await finishProgress("生成完成");
      setShowGenerationPage(false);
      setSelected(saved);
    } catch (e: any) {
      stopProgress();
      setShowGenerationPage(false);
      if (/cancelled|已取消生成/.test(e?.message || String(e))) {
        setProgressText("");
      } else {
        Alert.alert("生成失败", friendlyErrorMessage(e));
      }
    } finally {
      if (generateAbortRef.current === controller) generateAbortRef.current = null;
      setGenerating(false);
    }
  }

  async function saveToAlbum(item: GenerateResult) {
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted)
        return Alert.alert("需要相册权限", "请允许保存图片到相册。");
      const uri = item.localUri || (await persistImage(item)).localUri;
      if (!uri) throw new Error("图片文件不存在");
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert("已保存", "图片已保存到系统相册。");
    } catch (e: any) {
      Alert.alert("保存失败", e.message || String(e));
    }
  }

  async function editAgain(item: GenerateResult) {
    try {
      const saved = item.localUri ? item : await persistImage(item);
      const uri = saved.localUri || saved.url;
      if (!uri.startsWith("file:"))
        throw new Error("无法把这张图转换成本地参考图文件");
      setRefs([
        { name: "generated-reference.png", uri, mimeType: "image/png" },
      ]);
      setMode("edit");
      setTab("create");
      setPrompt("在这张图基础上，");
      setSelected(null);
    } catch (e: any) {
      Alert.alert("再次修改失败", e.message || String(e));
    }
  }

  async function copyPrompt(text?: string) {
    const value = (text || "").trim();
    if (!value) return Alert.alert("没有可复制的提示词");
    await Clipboard.setStringAsync(value);
    Alert.alert("已复制", "提示词已复制到剪贴板。");
  }

  function clearHistory() {
    Alert.alert("清空历史", "会清空 App 内作品流记录，不删除系统相册。", [
      { text: "取消" },
      { text: "清空", style: "destructive", onPress: () => setResults([]) },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.bg} pointerEvents="none">
          <View style={[styles.glow, styles.cyan]} />
          <View style={[styles.glow, styles.amber]} />
          <View style={[styles.glow, styles.orange]} />
          <View style={styles.sheen} />
        </View>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.pageFrame, { width: pageWidth }]}>
          <View style={styles.top}>
            <View>
              <Text style={styles.brand}>
                {showGenerationPage ? "生成中" : tab === "create" ? "画刃" : tab === "gallery" ? "作品" : "设置"}
              </Text>
              <Text style={styles.brandSub}>
                {showGenerationPage ? "保持前台，完成后自动预览" : tab === "create" ? "移动 AI 图像工作台" : tab === "gallery" ? "复用、保存和继续改图" : "接口、模型和偏好"}
              </Text>
            </View>
            <Pressable style={styles.pill} onPress={() => setTab("profile")}>
              <View
                style={[
                  styles.dot,
                  imageConfigured ? styles.dotOk : styles.dotOff,
                ]}
              />
              <Text style={styles.pillText}>
                {imageConfigured
                  ? imageApiBase.includes("sharehub")
                    ? "ShareHub"
                    : imageApiBase.includes("pucoding")
                      ? "PuCoding"
                      : "已连接"
                  : "未配置"}
              </Text>
            </Pressable>
          </View>
          {showGenerationPage && (
            <View style={styles.generationPage}>
              <View style={styles.generationHero}>
                <Text style={styles.generationKicker}>GENERATING</Text>
                <Text style={styles.generationTitle}>
                  {mode === "edit" ? "正在以图改图" : "正在生成图片"}
                </Text>
                <Text style={styles.generationSub}>
                  {progressText || "正在排队渲染画面，请保持应用在前台。"}
                </Text>
              </View>

              <View style={styles.generationProgressCard}>
                <View style={styles.generationRing}>
                  <Text style={styles.generationPct}>{Math.round(progress * 100)}%</Text>
                  <Text style={styles.generationPctSub}>画面成型中</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: (String(Math.round(progress * 100)) + "%") as any },
                    ]}
                  />
                </View>
              </View>

              <View style={styles.generationMetaCard}>
                <View style={styles.generationMetaRow}>
                  <Text style={styles.generationMetaLabel}>模式</Text>
                  <Text style={styles.generationMetaValue}>{mode === "edit" ? "参考图" : "文生图"}</Text>
                </View>
                <View style={styles.generationMetaRow}>
                  <Text style={styles.generationMetaLabel}>尺寸</Text>
                  <Text style={styles.generationMetaValue}>
                    {size} · {resolution === "std" ? "标准" : resolution.toUpperCase()}
                  </Text>
                </View>
                <View style={styles.generationMetaRow}>
                  <Text style={styles.generationMetaLabel}>风格</Text>
                  <Text style={styles.generationMetaValue}>{style}</Text>
                </View>
              </View>

              <Pressable style={styles.generationCancel} onPress={cancelGenerate}>
                <Ionicons name="close-circle-outline" size={19} color="#FFD7D2" />
                <Text style={styles.cancelTaskText}>取消生成</Text>
              </Pressable>
            </View>
          )}
          {!showGenerationPage && tab === "create" && (
            <>
              <View style={styles.studioHero}>
                <View style={styles.logoMark}>
                  <View style={styles.logoRing} />
                  <Ionicons name="sparkles" size={18} color="#F4F7F2" />
                </View>
                <View style={styles.studioCopy}>
                  <Text style={styles.studioKicker}>HUAREN AI</Text>
                  <Text style={styles.studioTitle}>
                    AI 创造 · 无限想象
                  </Text>
                  <Text style={styles.studioSub}>
                    {mode === "generate" ? "输入想象，选择风格，一键生成你的视觉作品。" : "用参考图延展构图、光影和商业质感。"}
                  </Text>
                </View>
              </View>

              <View style={styles.modeSwitch}>
                {(["generate", "edit"] as Mode[]).map((m) => (
                  <Pressable
                    key={m}
                    style={[styles.modePill, m === mode && styles.modePillActive]}
                    onPress={() => setMode(m)}
                  >
                    <Ionicons name={m === "generate" ? "text-outline" : "image-outline"} size={16} color={m === mode ? C.bg : "rgba(237,239,247,.56)"} />
                    <Text style={m === mode ? styles.modePillTextActive : styles.modePillText}>
                      {m === "generate" ? "文生图" : "参考图"}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.composerCard}>
                <View style={styles.composerAura} pointerEvents="none" />
                <View style={styles.promptHead}>
                  <View style={styles.promptCopy}>
                    <Text style={styles.promptLabel}>描述你的想象</Text>
                    <Text style={styles.promptHint}>AI 会为你创建独一无二的作品</Text>
                  </View>
                  <View style={styles.headActions}>
                    <Pressable
                      style={styles.magic}
                      onPress={runAssistant}
                      disabled={assisting || optimizing}
                    >
                      <Ionicons name="bulb" size={14} color="#bfe9ff" />
                      <Text style={[styles.magicText, styles.magicTextBlue]}>
                        {assisting ? "思考中" : "助手"}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={styles.magic}
                      onPress={runOptimize}
                      disabled={optimizing || assisting}
                    >
                      <Ionicons name="sparkles" size={14} color="#fff3c2" />
                      <Text style={styles.magicText}>
                        {optimizing ? "优化中" : "优化"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
                <TextInput
                  style={styles.promptInputDock}
                  multiline
                  placeholder="一张 618 足浴盆电商主图，白色产品置于明亮浴室环境，干净高级，暖色灯光，商业摄影质感。"
                  placeholderTextColor="rgba(247,249,255,.45)"
                  value={prompt}
                  onChangeText={setPrompt}
                  editable={!generating && !optimizing}
                />

                {!!assistantMsg && (
                  <View style={styles.assistCard}>
                    <View style={styles.assistHead}>
                      <Ionicons name="sparkles" size={14} color={C.purple} />
                      <Text style={styles.assistTitle}>创作助手</Text>
                      <Pressable
                        hitSlop={10}
                        onPress={() => {
                          setAssistantMsg("");
                          setAssistantChips([]);
                        }}
                      >
                        <Ionicons name="close" size={16} color={C.muted} />
                      </Pressable>
                    </View>
                    <Text style={styles.assistMsg}>{assistantMsg}</Text>
                    {!!assistantChips.length && (
                      <View style={styles.assistChips}>
                        {assistantChips.map((c, i) => (
                          <Pressable
                            key={i}
                            style={styles.assistChip}
                            onPress={() => applyChip(c)}
                          >
                            <Text style={styles.assistChipText}>＋ {c}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                )}

                <Pressable
                  style={[
                    styles.inlinePrimary,
                    generating && styles.cancelPrimary,
                    !generating && generateDisabled && styles.inlinePrimaryOff,
                  ]}
                  onPress={generating ? cancelGenerate : runGenerate}
                  disabled={!generating && generateDisabled}
                >
                  <Text
                    style={[
                      styles.inlinePrimaryText,
                      !generating && generateDisabled && styles.inlinePrimaryTextOff,
                    ]}
                  >
                    {!hydrated
                      ? "正在恢复数据..."
                      : generating
                        ? "取消生成"
                        : editBlocked
                          ? "请先上传参考图"
                          : "开始创作"}
                  </Text>
                  <Ionicons
                    name={generating ? "close" : "sparkles"}
                    size={18}
                    color={!generating && generateDisabled ? "rgba(237,239,247,.45)" : C.bg}
                  />
                </Pressable>
              </View>

              <View style={styles.sectionHeadTight}>
                <Text style={styles.sectionTitle}>选择风格</Text>
                <Pressable onPress={() => setShowPromptPlaza(true)}>
                  <Text style={styles.sectionLink}>查看全部</Text>
                </Pressable>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.styleShowcaseRow}>
                {styleShowcase.map((item) => {
                  const active = style === item.name;
                  return (
                    <Pressable
                      key={item.name}
                      style={[styles.styleShowcaseCard, active && styles.styleShowcaseActive]}
                      onPress={() => setStyle(item.name)}
                    >
                      <View style={[styles.styleShowcaseIcon, { backgroundColor: `${item.accent}26`, borderColor: `${item.accent}55` }]}>
                        <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={18} color={item.accent} />
                      </View>
                      <Text style={styles.styleShowcaseTitle}>{item.title}</Text>
                      <Text style={styles.styleShowcaseSub}>{item.sub}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <View style={styles.toolPanel}>
                <Text style={styles.sectionTitle}>创作工具</Text>
                <View style={styles.toolGrid}>
                  <Pressable style={styles.toolBox} onPress={() => setShowPromptPlaza(true)}>
                    <Ionicons name="albums-outline" size={18} color={C.purple} />
                    <Text style={styles.toolBoxText}>提示词</Text>
                  </Pressable>
                  <Pressable style={styles.toolBox} onPress={pickImages}>
                    <Ionicons name="image-outline" size={18} color={C.purple} />
                    <Text style={styles.toolBoxText}>{refs.length ? `参考 ${refs.length}/4` : "参考图"}</Text>
                  </Pressable>
                  <Pressable style={styles.toolBox} onPress={runAssistant} disabled={assisting || optimizing}>
                    <Ionicons name="bulb-outline" size={18} color={C.purple} />
                    <Text style={styles.toolBoxText}>{assisting ? "思考中" : "灵感"}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.toolBox, !prompt && styles.disabled]}
                    onPress={() => setPrompt("")}
                    disabled={!prompt}
                  >
                    <Ionicons name="backspace-outline" size={18} color={C.purple} />
                    <Text style={styles.toolBoxText}>清空</Text>
                  </Pressable>
                </View>

                <View style={styles.toolRail}>
                  <Text style={styles.railLabel}>尺寸</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
                    {sizeOptions.map((r) => {
                      const active = size === r.key;
                      return (
                        <Pressable
                          key={r.key}
                          style={[styles.miniChip, active && styles.miniChipActive]}
                          onPress={() => setSize(r.key)}
                        >
                          <Text style={active ? styles.miniChipTextActive : styles.miniChipText}>
                            {r.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                <View style={[styles.toolRail, styles.toolRailLast]}>
                  <Text style={styles.railLabel}>清晰度</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
                    {resolutionOptions.map((r) => {
                      const active = resolution === r.key;
                      return (
                        <Pressable
                          key={r.key}
                          style={[styles.miniChip, active && styles.miniChipActive]}
                          onPress={() => setResolution(r.key)}
                        >
                          <Text style={active ? styles.miniChipTextActive : styles.miniChipText}>
                            {r.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                {!!refs.length && (
                  <View style={styles.refStrip}>
                    {refs.map((r, i) => (
                      <Pressable
                        key={i}
                        style={styles.refWrap}
                        onPress={() => setRefs(refs.filter((_, idx) => idx !== i))}
                      >
                        <Image source={{ uri: r.uri }} style={styles.refThumb} />
                        <View style={styles.refRemove}><Ionicons name="close" size={12} color="#fff" /></View>
                      </Pressable>
                    ))}
                  </View>
                )}

              </View>

              {editBlocked && (
                <Text style={styles.warnText}>
                  以图改图需要先上传参考图，否则不会请求接口。
                </Text>
              )}
            </>
          )}
          {!showGenerationPage && tab === "gallery" && (
            <View>
              <View style={styles.galleryHero}>
                <View>
                  <Text style={styles.galleryHeroTitle}>创作资产库</Text>
                  <Text style={styles.galleryHeroSub}>共 {results.length} 张作品，点击可预览或继续改图</Text>
                </View>
                {!!results.length && (
                  <Pressable style={styles.smallBtn} onPress={clearHistory}>
                    <Text style={styles.smallBtnText}>清空</Text>
                  </Pressable>
                )}
              </View>
              <View style={styles.filterRow}>
                {([
                  ["all", "全部"],
                  ["recent", "最近"],
                  ["fast", "快速"],
                ] as [typeof galleryFilter, string][]).map(([key, label]) => {
                  const active = galleryFilter === key;
                  return (
                    <Pressable
                      key={key}
                      style={[styles.filterChip, active && styles.filterChipActive]}
                      onPress={() => setGalleryFilter(key)}
                    >
                      <Text style={active ? styles.filterTextActive : styles.filterText}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {!results.length && (
                <View style={styles.galleryEmpty}>
                  <Ionicons name="images-outline" size={34} color="rgba(237,239,247,.38)" />
                  <Text style={styles.galleryEmptyTitle}>{hydrated ? "还没有作品" : "正在恢复作品..."}</Text>
                  <Text style={styles.galleryEmptySub}>去创作页生成第一张图，它会自动出现在这里。</Text>
                </View>
              )}
              {!!results.length && !galleryResults.length && (
                <View style={styles.galleryEmpty}>
                  <Ionicons name="funnel-outline" size={30} color="rgba(237,239,247,.38)" />
                  <Text style={styles.galleryEmptyTitle}>当前筛选没有作品</Text>
                  <Text style={styles.galleryEmptySub}>切回「全部」查看完整作品流。</Text>
                </View>
              )}
              <View style={styles.masonry}>
                {galleryResults.map((r, i) => (
                  <Pressable
                    key={r.id || r.url + "-" + i}
                    style={[styles.tile, i % 3 === 1 && styles.tileTall]}
                    onPress={() => setSelected(r)}
                  >
                    <Image source={{ uri: r.localUri || r.url }} style={styles.tileImg} />
                    <View style={styles.tileShade} />
                    <View style={styles.tileMeta}>
                      <Text style={styles.tileText}>{r.elapsed ? r.elapsed + "s" : "作品"}</Text>
                      <Text style={styles.tileSub}>AI 生成</Text>
                    </View>
                    <Pressable style={styles.tileEdit} onPress={() => editAgain(r)}>
                      <Ionicons name="create-outline" size={15} color="#fff" />
                    </Pressable>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          {!showGenerationPage && tab === "profile" && (
            <>
              <View style={styles.settingsCard}>
                <Pressable
                  style={styles.configHero}
                  onPress={() => setExpandedConfig((v) => !v)}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.configKicker}>MY CONFIG</Text>
                    <Text style={styles.configTitle}>我的配置</Text>
                    <Text style={styles.configSub}>{connected}</Text>
                  </View>
                  <View style={styles.configHeroAction}>
                    <Text style={styles.editText}>{expandedConfig ? "收起" : "展开"}</Text>
                    <Ionicons name={expandedConfig ? "chevron-up" : "chevron-down"} size={17} color="#fff1bd" />
                  </View>
                </Pressable>
                {expandedConfig && (
                  <>
                    <View style={styles.configStats}>
                      <View style={styles.profileStat}><Text style={styles.profileStatNum}>{results.length}</Text><Text style={styles.profileStatLabel}>作品</Text></View>
                      <View style={styles.profileStat}><Text style={styles.profileStatNum}>{imageConfigured ? "已连" : "待配"}</Text><Text style={styles.profileStatLabel}>生图</Text></View>
                      <View style={styles.profileStat}><Text style={styles.profileStatNum}>{textConfigured ? "已连" : "待配"}</Text><Text style={styles.profileStatLabel}>文本</Text></View>
                    </View>
                    <View style={styles.configToolbar}>
                      <Pressable style={styles.statusAction} onPress={checkHealth}>
                        <Text style={styles.statusActionText}>测试连接</Text>
                      </Pressable>
                    </View>
                <Pressable
                  style={styles.settingsRow}
                  onPress={() => setExpandedImageSettings((v) => !v)}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>生图接口</Text>
                    <Text style={styles.rowSub}>
                      {imageConfigSummary}
                    </Text>
                  </View>
                  <Text style={styles.editText}>
                    {expandedImageSettings ? "收起" : "编辑"}
                  </Text>
                </Pressable>
                {expandedImageSettings && (
                  <View style={styles.settingsBody}>
                    <View style={styles.presets}>
                      <Pressable
                        style={styles.preset}
                        onPress={() => {
                          setImageApiBase(DEFAULT_IMAGE_API_BASE);
                          setImageApiKey(DEFAULT_IMAGE_API_KEY);
                          setImageModel(DEFAULT_IMAGE_MODEL_VALUE);
                        }}
                      >
                        <Text style={styles.presetText}>BeeHears</Text>
                      </Pressable>
                      <Pressable
                        style={styles.preset}
                        onPress={() =>
                          setImageApiBase("https://api.sharehub.club")
                        }
                      >
                        <Text style={styles.presetText}>ShareHub</Text>
                      </Pressable>
                      <Pressable
                        style={styles.preset}
                        onPress={() => setImageApiBase("https://pucoding.com")}
                      >
                        <Text style={styles.presetText}>PuCoding</Text>
                      </Pressable>
                    </View>
                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>Base</Text>
                      <TextInput
                        style={styles.fieldInput}
                        autoCapitalize="none"
                        autoCorrect={false}
                        value={imageApiBase}
                        onChangeText={setImageApiBase}
                      />
                    </View>
                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>Key</Text>
                      <TextInput
                        style={styles.fieldInput}
                        autoCapitalize="none"
                        autoCorrect={false}
                        secureTextEntry
                        value={imageApiKey}
                        onChangeText={setImageApiKey}
                      />
                    </View>
                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>Model</Text>
                      <TextInput
                        style={styles.fieldInput}
                        autoCapitalize="none"
                        autoCorrect={false}
                        value={imageModel}
                        onChangeText={setImageModel}
                      />
                    </View>
                  </View>
                )}
                <Pressable
                  style={styles.settingsRow}
                  onPress={() => setExpandedTextSettings((v) => !v)}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>文本接口</Text>
                    <Text style={styles.rowSub}>
                      {textConfigSummary}
                    </Text>
                  </View>
                  <Text style={styles.editText}>
                    {expandedTextSettings ? "收起" : "编辑"}
                  </Text>
                </Pressable>
                {expandedTextSettings && (
                  <View style={styles.settingsBody}>
                    <View style={styles.presets}>
                      <Pressable
                        style={styles.preset}
                        onPress={() => {
                          setTextApiBase(DEFAULT_TEXT_API_BASE);
                          setTextApiKey(DEFAULT_TEXT_API_KEY);
                          setTextModel(DEFAULT_TEXT_MODEL_VALUE);
                        }}
                      >
                        <Text style={styles.presetText}>BeeHears</Text>
                      </Pressable>
                      <Pressable
                        style={styles.preset}
                        onPress={() =>
                          setTextApiBase("https://api.sharehub.club")
                        }
                      >
                        <Text style={styles.presetText}>ShareHub</Text>
                      </Pressable>
                      <Pressable
                        style={styles.preset}
                        onPress={() => setTextApiBase("https://pucoding.com")}
                      >
                        <Text style={styles.presetText}>PuCoding</Text>
                      </Pressable>
                    </View>
                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>Base</Text>
                      <TextInput
                        style={styles.fieldInput}
                        autoCapitalize="none"
                        autoCorrect={false}
                        value={textApiBase}
                        onChangeText={setTextApiBase}
                      />
                    </View>
                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>Key</Text>
                      <TextInput
                        style={styles.fieldInput}
                        autoCapitalize="none"
                        autoCorrect={false}
                        secureTextEntry
                        value={textApiKey}
                        onChangeText={setTextApiKey}
                      />
                    </View>
                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>Model</Text>
                      <TextInput
                        style={styles.fieldInput}
                        autoCapitalize="none"
                        autoCorrect={false}
                        value={textModel}
                        onChangeText={setTextModel}
                      />
                    </View>
                  </View>
                )}
                <Pressable
                  style={styles.settingsRow}
                  onPress={() => setExpandedPlazaSettings((v) => !v)}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>提示词广场</Text>
                    <Text style={styles.rowSub}>
                      {promptPlazaUrl.trim() ? promptPlazaUrl.trim() : "内置精选模板，可外接地址"}
                    </Text>
                  </View>
                  <Text style={styles.editText}>
                    {expandedPlazaSettings ? "收起" : "编辑"}
                  </Text>
                </Pressable>
                {expandedPlazaSettings && (
                  <View style={styles.settingsBody}>
                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>URL</Text>
                      <TextInput
                        style={styles.fieldInput}
                        autoCapitalize="none"
                        autoCorrect={false}
                        placeholder={DEFAULT_PROMPT_PLAZA_URL}
                        placeholderTextColor="rgba(244,247,242,.34)"
                        value={promptPlazaUrl}
                        onChangeText={setPromptPlazaUrl}
                      />
                    </View>
                    <Pressable style={styles.configAction} onPress={() => setShowPromptPlaza(true)}>
                      <Ionicons name="albums-outline" size={17} color={C.bg} />
                      <Text style={styles.configActionText}>打开提示词广场</Text>
                    </Pressable>
                  </View>
                )}
                  </>
                )}
              </View>
            </>
          )}
          </View>
        </ScrollView>
        {!showGenerationPage && <View style={[styles.tabs, { left: pageLeft, width: pageWidth }]}>
          {(
            [
              ["create", "创作", "sparkles-outline"],
              ["gallery", "画廊", "images-outline"],
              ["profile", "设置", "sliders-outline"],
            ] as [Tab, string, keyof typeof Ionicons.glyphMap][]
          ).map(([key, label, icon]) => {
            const active = tab === key;
            return (
              <Pressable
                key={key}
                style={[styles.tab, active && styles.tabActive]}
                onPress={() => setTab(key)}
              >
                <Ionicons name={icon} size={20} color={active ? C.purple : "rgba(237,239,247,.50)"} />
                <Text style={active ? styles.tabTextActive : styles.tabText}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>}
        <Modal
          visible={!!selected}
          animationType="slide"
          onRequestClose={() => setSelected(null)}
        >
          <SafeAreaView style={styles.modalSafe}>
            {selected && (
              <>
                <Pressable
                  style={styles.modalClose}
                  onPress={() => setSelected(null)}
                >
                  <Ionicons name="close" size={28} color="#f7f9ff" />
                </Pressable>
                <Image
                  source={{ uri: selected.localUri || selected.url }}
                  style={styles.modalImg}
                  resizeMode="contain"
                />
                <View style={styles.modalPanel}>
                  <Text style={styles.modalTitle}>作品详情</Text>
                  <Text style={styles.modalPrompt} numberOfLines={4}>
                    {selected.prompt || selected.revised_prompt || ""}
                  </Text>
                  <View style={styles.modalActions}>
                    <Pressable
                      style={styles.modalAction}
                      onPress={() => saveToAlbum(selected)}
                    >
                      <Text style={styles.modalActionText}>保存</Text>
                    </Pressable>
                    <Pressable
                      style={styles.modalAction}
                      onPress={() =>
                        copyPrompt(selected.prompt || selected.revised_prompt)
                      }
                    >
                      <Text style={styles.modalActionText}>复制</Text>
                    </Pressable>
                    <Pressable
                      style={styles.modalActionHot}
                      onPress={() => editAgain(selected)}
                    >
                      <Text style={styles.modalActionHotText}>再改</Text>
                    </Pressable>
                  </View>
                </View>
              </>
            )}
          </SafeAreaView>
        </Modal>
        <Modal
          visible={showPromptPlaza}
          animationType="slide"
          onRequestClose={() => setShowPromptPlaza(false)}
        >
          <SafeAreaView style={styles.modalSafe}>
            <View style={styles.plazaModalHeader}>
              <View>
                <Text style={styles.plazaModalKicker}>PROMPT PLAZA</Text>
                <Text style={styles.plazaModalTitle}>提示词广场</Text>
              </View>
              <Pressable style={styles.modalCloseSmall} onPress={() => setShowPromptPlaza(false)}>
                <Ionicons name="close" size={22} color={C.ink} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.plazaModalBody}>
              <Pressable style={styles.externalPlazaCard} onPress={openPromptPlazaUrl}>
                <View>
                  <Text style={styles.externalPlazaTitle}>外接提示词广场</Text>
                  <Text style={styles.externalPlazaSub}>
                    {promptPlazaUrl.trim() || "在「我的配置」里填 URL 后可打开外部广场"}
                  </Text>
                </View>
                <Ionicons name="open-outline" size={20} color={C.purple} />
              </Pressable>
              {promptPlaza.map((item) => (
                <Pressable key={item.title} style={styles.plazaItem} onPress={() => applyPromptPreset(item)}>
                  <View style={styles.plazaItemTop}>
                    <Text style={styles.plazaItemTag}>{item.tag}</Text>
                    <Text style={styles.plazaItemStyle}>{item.style}</Text>
                  </View>
                  <Text style={styles.plazaItemTitle}>{item.title}</Text>
                  <Text style={styles.plazaItemPrompt}>{item.prompt}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const C = {
  ink: "#F6F7FF",
  muted: "rgba(226,232,255,.64)",
  hair: "rgba(255,255,255,.14)",
  hairSoft: "rgba(255,255,255,.08)",
  glass: "rgba(15,22,42,.78)",
  amber: "#8EA2FF",
  purple: "#8B7CFF",
  cyan: "#64D9FF",
  violet: "#B18CFF",
  green: "#4ADE80",
  bg: "#060915",
};
const glass = {
  backgroundColor: C.glass,
  borderWidth: 1,
  borderColor: C.hairSoft,
  shadowColor: "#000",
  shadowOpacity: 0.22,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: 10 },
  elevation: 6,
};
const plain = {
  backgroundColor: "#10171F",
  borderWidth: 1,
  borderColor: C.hairSoft,
};
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  flex: { flex: 1 },
  bg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: C.bg,
    overflow: "hidden",
  },
  glow: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 130,
    opacity: 0.55,
  },
  cyan: { left: -80, top: -54, backgroundColor: "rgba(100,217,255,.18)" },
  amber: { right: -92, top: 88, backgroundColor: "rgba(139,124,255,.16)" },
  orange: { right: -70, bottom: 52, backgroundColor: "rgba(177,140,255,.13)" },
  sheen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,.018)",
  },
  content: {
    paddingTop: Platform.OS === "ios" ? 10 : 10,
    paddingHorizontal: 20,
    paddingBottom: 230,
  },
  pageFrame: { alignSelf: "flex-start" },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },
  brand: { color: C.ink, fontSize: 21, lineHeight: 27, fontWeight: "900", letterSpacing: 0 },
  brandSub: { color: C.muted, fontSize: 12, fontWeight: "700", marginTop: 3 },
  pill: {
    backgroundColor: "rgba(139,124,255,.12)",
    borderWidth: 1,
    borderColor: "rgba(142,162,255,.24)",
    height: 32,
    borderRadius: 999,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  dot: { width: 7, height: 7, borderRadius: 99 },
  dotOk: { backgroundColor: C.green },
  dotOff: { backgroundColor: "rgba(255,255,255,.32)" },
  pillText: { color: "rgba(255,255,255,.84)", fontSize: 11, fontWeight: "900" },

  heroCard: {
    backgroundColor: "#12152A",
    borderWidth: 1,
    borderColor: "rgba(120,220,202,.20)",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
    borderRadius: 24,
    padding: 18,
    marginBottom: 14,
  },
  heroBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(120,220,202,.12)",
    marginBottom: 14,
  },
  heroBadgeText: { color: C.purple, fontSize: 11, fontWeight: "900" },
  heroTitle: { color: C.ink, fontSize: 26, lineHeight: 32, fontWeight: "800", letterSpacing: 0 },
  heroSub: { color: C.muted, fontSize: 13, lineHeight: 21, fontWeight: "700", marginTop: 8, marginBottom: 18 },
  heroButton: {
    height: 48,
    borderRadius: 16,
    backgroundColor: C.amber,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  heroButtonText: { color: "#fff", fontSize: 15, fontWeight: "900" },
  quickGrid: { flexDirection: "row", gap: 10, marginBottom: 18 },
  quickCard: {
    backgroundColor: "#1A1E36",
    borderWidth: 1,
    borderColor: C.hairSoft,
    flex: 1,
    minHeight: 112,
    borderRadius: 18,
    padding: 14,
    justifyContent: "center",
  },
  quickTitle: { color: C.ink, fontSize: 15, fontWeight: "900", marginTop: 10 },
  quickSub: { color: C.muted, fontSize: 11, lineHeight: 17, fontWeight: "800", marginTop: 4 },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  sectionTitle: { color: C.ink, fontSize: 17, fontWeight: "900" },
  sectionLink: { color: C.purple, fontSize: 12, fontWeight: "900" },
  recentRow: { gap: 10, paddingRight: 18 },
  recentCard: {
    width: 126,
    height: 160,
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.hairSoft,
    backgroundColor: "rgba(255,255,255,.08)",
  },
  recentImg: { width: "100%", height: "100%", position: "absolute" },
  recentShade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,.18)" },
  recentText: { position: "absolute", left: 12, bottom: 12, color: "#fff", fontSize: 11, fontWeight: "900" },
  emptyHome: {
    ...plain,
    height: 132,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  emptyHomeText: { color: C.muted, fontSize: 13, fontWeight: "800" },

  studioHero: {
    minHeight: 88,
    borderRadius: 22,
    backgroundColor: "rgba(17,24,50,.78)",
    borderWidth: 1,
    borderColor: "rgba(142,162,255,.18)",
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
    overflow: "hidden",
    shadowColor: "#8B7CFF",
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 7,
  },
  logoMark: {
    width: 48,
    height: 48,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(139,124,255,.16)",
    borderWidth: 1,
    borderColor: "rgba(142,162,255,.36)",
  },
  logoRing: {
    position: "absolute",
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: "rgba(100,217,255,.34)",
  },
  studioCopy: { flex: 1, minWidth: 0 },
  studioKicker: {
    color: C.purple,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0,
    marginBottom: 4,
  },
  studioTitle: {
    color: C.ink,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "900",
    letterSpacing: 0,
  },
  studioSub: {
    color: C.muted,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    marginTop: 4,
  },
  modeSwitch: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 7,
  },
  modePill: {
    width: "48.7%",
    height: 40,
    borderRadius: 15,
    backgroundColor: "rgba(17,24,50,.76)",
    borderWidth: 1,
    borderColor: C.hairSoft,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  modePillActive: {
    backgroundColor: "rgba(142,162,255,.92)",
    borderColor: "rgba(255,255,255,.22)",
  },
  modePillText: { color: C.muted, fontSize: 13, fontWeight: "900" },
  modePillTextActive: { color: C.bg, fontSize: 13, fontWeight: "900" },
  canvasCard: {
    minHeight: 214,
    borderRadius: 24,
    backgroundColor: "#0E141B",
    borderWidth: 1,
    borderColor: "rgba(120,220,202,.18)",
    overflow: "hidden",
    marginBottom: 10,
    shadowColor: "#000",
    shadowOpacity: 0.32,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 10,
  },
  canvasImage: {
    width: "100%",
    height: "100%",
    position: "absolute",
  },
  canvasEmpty: {
    minHeight: 214,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  canvasAura: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "rgba(120,220,202,.10)",
  },
  canvasIcon: {
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: "rgba(120,220,202,.12)",
    borderWidth: 1,
    borderColor: "rgba(120,220,202,.24)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  canvasEmptyTitle: {
    color: C.ink,
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
  },
  canvasEmptySub: {
    color: C.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 7,
  },
  canvasTopbar: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  canvasBadge: {
    height: 30,
    borderRadius: 999,
    backgroundColor: C.purple,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  canvasBadgeText: { color: C.bg, fontSize: 11, fontWeight: "900" },
  canvasMeta: {
    color: "rgba(244,247,242,.72)",
    fontSize: 11,
    fontWeight: "900",
    backgroundColor: "rgba(7,10,14,.58)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.08)",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    overflow: "hidden",
  },
  canvasRefs: {
    position: "absolute",
    left: 12,
    bottom: 12,
    flexDirection: "row",
    gap: 7,
  },
  canvasRefThumb: {
    width: 42,
    height: 42,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.25)",
  },
  inspirationCard: {
    backgroundColor: "#10171F",
    borderWidth: 1,
    borderColor: "rgba(120,220,202,.18)",
    borderRadius: 22,
    padding: 14,
    marginBottom: 10,
  },
  inspirationHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  inspirationKicker: {
    color: C.purple,
    fontSize: 10,
    fontWeight: "900",
    marginBottom: 4,
  },
  inspirationTitle: { color: C.ink, fontSize: 17, fontWeight: "900" },
  inspirationAction: {
    height: 34,
    borderRadius: 13,
    backgroundColor: C.purple,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  inspirationActionText: { color: C.bg, fontSize: 12, fontWeight: "900" },
  seedRow: { gap: 9, paddingRight: 4 },
  seedCard: {
    width: 154,
    minHeight: 108,
    borderRadius: 17,
    backgroundColor: "#17212B",
    borderWidth: 1,
    borderColor: C.hairSoft,
    padding: 12,
  },
  seedTag: {
    alignSelf: "flex-start",
    color: C.bg,
    backgroundColor: C.amber,
    overflow: "hidden",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 10,
    fontWeight: "900",
    marginBottom: 8,
  },
  seedTitle: { color: C.ink, fontSize: 13, fontWeight: "900" },
  seedSub: { color: C.muted, fontSize: 11, lineHeight: 16, fontWeight: "700", marginTop: 6 },
  composerCard: {
    backgroundColor: "rgba(18,25,54,.86)",
    borderWidth: 1,
    borderColor: "rgba(142,162,255,.20)",
    borderRadius: 22,
    padding: 14,
    marginBottom: 11,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.26,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  composerAura: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    right: -34,
    top: -42,
    backgroundColor: "rgba(100,217,255,.10)",
  },
  promptInputDock: {
    minHeight: 90,
    maxHeight: 134,
    width: "100%",
    color: C.ink,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "600",
    textAlignVertical: "top",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.07)",
    backgroundColor: "rgba(6,9,21,.38)",
  },
  promptHint: { color: "rgba(226,232,255,.46)", fontSize: 10, lineHeight: 14, fontWeight: "700", marginTop: 4 },
  sectionHeadTight: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  styleShowcaseRow: { gap: 8, paddingRight: 20, marginBottom: 10 },
  styleShowcaseCard: {
    width: 78,
    height: 92,
    borderRadius: 18,
    backgroundColor: "rgba(18,25,54,.82)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.09)",
    padding: 10,
    justifyContent: "space-between",
  },
  styleShowcaseActive: {
    borderColor: "rgba(142,162,255,.58)",
    backgroundColor: "rgba(50,56,112,.72)",
  },
  styleShowcaseIcon: {
    width: 30,
    height: 30,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  styleShowcaseTitle: { color: C.ink, fontSize: 13, fontWeight: "900" },
  styleShowcaseSub: { color: C.muted, fontSize: 9, fontWeight: "800", marginTop: 3 },
  toolPanel: {
    backgroundColor: "rgba(18,25,54,.78)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.09)",
    borderRadius: 22,
    padding: 12,
    marginBottom: 16,
  },
  toolGrid: {
    flexDirection: "row",
    flexWrap: "nowrap",
    justifyContent: "space-between",
    marginTop: 10,
    marginBottom: 10,
  },
  toolBox: {
    width: "23.2%",
    height: 56,
    borderRadius: 16,
    backgroundColor: "rgba(8,12,28,.74)",
    borderWidth: 1,
    borderColor: "rgba(142,162,255,.16)",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 4,
  },
  toolBoxText: { color: C.ink, fontSize: 10, fontWeight: "900" },
  toolRail: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  toolRailLast: { marginBottom: 0 },
  railLabel: {
    width: 44,
    color: "rgba(226,232,255,.54)",
    fontSize: 11,
    fontWeight: "900",
  },
  optionRow: { gap: 7, paddingRight: 8 },
  miniChip: {
    height: 28,
    borderRadius: 999,
    paddingHorizontal: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8,12,28,.68)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.08)",
  },
  miniChipActive: {
    backgroundColor: "rgba(142,162,255,.18)",
    borderColor: "rgba(142,162,255,.48)",
  },
  miniChipText: { color: C.muted, fontSize: 11, fontWeight: "900" },
  miniChipTextActive: { color: C.purple, fontSize: 11, fontWeight: "900" },
  composerBottom: {
    flexDirection: "row",
    gap: 8,
    marginTop: 2,
    marginBottom: 8,
  },
  plazaButton: {
    width: 116,
    height: 40,
    borderRadius: 14,
    backgroundColor: "#17212B",
    borderWidth: 1,
    borderColor: "rgba(120,220,202,.18)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  plazaButtonText: { color: C.purple, fontSize: 12, fontWeight: "900" },
  refButton: {
    flex: 1,
    height: 40,
    borderRadius: 14,
    backgroundColor: "#17212B",
    borderWidth: 1,
    borderColor: "rgba(120,220,202,.18)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  refButtonOn: {
    backgroundColor: C.purple,
    borderColor: C.purple,
  },
  refButtonText: { color: C.ink, fontSize: 12, fontWeight: "900" },
  secondaryTiny: {
    width: 78,
    height: 40,
    borderRadius: 14,
    backgroundColor: "#17212B",
    borderWidth: 1,
    borderColor: C.hairSoft,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  secondaryTinyText: { color: C.muted, fontSize: 12, fontWeight: "900" },
  inlinePrimary: {
    height: 50,
    borderRadius: 16,
    backgroundColor: C.amber,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 0,
    marginBottom: 0,
    shadowColor: C.purple,
    shadowOpacity: 0.30,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  inlinePrimaryOff: {
    backgroundColor: "rgba(255,255,255,.12)",
  },
  cancelPrimary: {
    backgroundColor: "#FFB0A6",
  },
  inlinePrimaryText: { color: "#06101E", fontSize: 16, fontWeight: "900" },
  inlinePrimaryTextOff: { color: "rgba(237,239,247,.45)" },

  createHero: {
    backgroundColor: "#12152A",
    borderWidth: 1,
    borderColor: "rgba(120,220,202,.20)",
    borderRadius: 22,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  createHeroIcon: {
    width: 48,
    height: 48,
    borderRadius: 18,
    backgroundColor: "rgba(120,220,202,.12)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(120,220,202,.30)",
  },
  createHeroTitle: { color: C.ink, fontSize: 17, fontWeight: "900" },
  createHeroSub: { color: C.muted, fontSize: 12, fontWeight: "600", marginTop: 4, lineHeight: 17 },
  modebar: {
    backgroundColor: "#12152A",
    borderWidth: 1,
    borderColor: C.hairSoft,
    marginBottom: 16,
    padding: 4,
    borderRadius: 999,
    flexDirection: "row",
    gap: 5,
  },
  mode: {
    flex: 1,
    height: 38,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  modeActive: { backgroundColor: "rgba(120,220,202,.15)", borderWidth: 1, borderColor: "rgba(120,220,202,.42)" },
  modeText: { color: "rgba(255,255,255,.66)", fontSize: 13, fontWeight: "900" },
  modeTextActive: { color: "#EDEFF7", fontSize: 13, fontWeight: "900" },
  promptCard: {
    backgroundColor: "#12152A",
    borderWidth: 1,
    borderColor: C.hairSoft,
    shadowColor: "#000",
    shadowOpacity: 0.20,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
    minHeight: 214,
    borderRadius: 16,
    padding: 16,
    marginBottom: 13,
  },
  promptHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
  },
  promptCopy: { flex: 1, minWidth: 0 },
  promptLabel: {
    color: C.purple,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  magic: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,.045)",
  },
  magicText: { color: C.amber, fontSize: 12, fontWeight: "900" },
  magicTextBlue: { color: C.purple },
  headActions: { flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 4 },
  assistCard: {
    backgroundColor: "rgba(120,220,202,.08)",
    borderWidth: 1,
    borderColor: "rgba(120,220,202,.24)",
    borderRadius: 18,
    padding: 15,
    marginBottom: 13,
  },
  assistHead: { flexDirection: "row", alignItems: "center", gap: 7 },
  assistTitle: {
    flex: 1,
    color: C.purple,
    fontSize: 12,
    fontWeight: "900",
  },
  assistMsg: {
    color: C.ink,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "600",
    marginTop: 10,
  },
  assistChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  assistChip: {
    backgroundColor: "rgba(120,220,202,.10)",
    borderWidth: 1,
    borderColor: "rgba(120,220,202,.28)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  assistChipText: { color: C.purple, fontSize: 12, fontWeight: "900" },
  promptInput: {
    flex: 1,
    minHeight: 154,
    color: C.ink,
    fontSize: 15,
    lineHeight: 24,
    fontWeight: "500",
    textAlignVertical: "top",
    padding: 0,
  },
  chipRow: { gap: 8, paddingRight: 18, marginBottom: 13 },
  chip: {
    backgroundColor: "#1A1E36",
    borderWidth: 1,
    borderColor: C.hairSoft,
    height: 34,
    borderRadius: 999,
    paddingHorizontal: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: {
    backgroundColor: "rgba(120,220,202,.14)",
    borderColor: "rgba(120,220,202,.34)",
  },
  chipText: { color: "rgba(255,255,255,.76)", fontSize: 12, fontWeight: "900" },
  chipTextActive: { color: C.purple, fontSize: 12, fontWeight: "900" },

  uploadPanel: {
    backgroundColor: "#12152A",
    borderWidth: 1,
    borderColor: C.hairSoft,
    borderRadius: 18,
    padding: 12,
    marginBottom: 12,
  },
  uploadHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  uploadTitle: { color: C.ink, fontSize: 14, fontWeight: "900" },
  uploadCount: { color: C.purple, fontSize: 12, fontWeight: "900" },
  uploadDrop: {
    minHeight: 86,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(120,220,202,.30)",
    backgroundColor: "rgba(120,220,202,.07)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
  },
  uploadIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "rgba(120,220,202,.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  uploadMain: { color: C.ink, fontSize: 15, fontWeight: "900" },
  uploadSub: { color: C.muted, fontSize: 11, fontWeight: "600", lineHeight: 16, marginTop: 3 },
  clearPrompt: {
    height: 40,
    borderRadius: 14,
    backgroundColor: "#1A1E36",
    borderWidth: 1,
    borderColor: C.hairSoft,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginBottom: 12,
  },
  clearPromptText: { color: C.muted, fontSize: 12, fontWeight: "800" },
  refWrap: { position: "relative" },
  refRemove: {
    position: "absolute",
    right: -5,
    top: -5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(15,18,36,.92)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  tools: { flexDirection: "row", gap: 9, marginBottom: 13 },
  tool: {
    backgroundColor: "#1A1E36",
    borderWidth: 1,
    borderColor: C.hairSoft,
    flex: 1,
    height: 68,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  toolText: { color: C.muted, fontSize: 11, fontWeight: "900" },
  disabled: { opacity: 0.48 },
  refStrip: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
    flexWrap: "wrap",
  },
  refThumb: {
    width: 62,
    height: 62,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.hair,
  },
  taskCard: {
    backgroundColor: "rgba(18,25,54,.86)",
    borderWidth: 1,
    borderColor: "rgba(142,162,255,.22)",
    minHeight: 238,
    borderRadius: 24,
    padding: 22,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    marginBottom: 12,
    shadowColor: C.purple,
    shadowOpacity: 0.18,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 14 },
    elevation: 8,
  },
  ring: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: "rgba(139,124,255,.12)",
    borderWidth: 3,
    borderColor: "rgba(142,162,255,.58)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  pct: { color: C.ink, fontSize: 30, fontWeight: "900" },
  pctSub: { color: C.muted, fontSize: 11, fontWeight: "900", marginTop: 3 },
  taskTitle: { color: C.ink, fontSize: 19, fontWeight: "900", marginBottom: 8 },
  taskSub: {
    color: C.muted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  cancelTaskButton: {
    height: 38,
    borderRadius: 14,
    paddingHorizontal: 13,
    marginTop: 14,
    backgroundColor: "rgba(255,176,166,.12)",
    borderWidth: 1,
    borderColor: "rgba(255,176,166,.28)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  cancelTaskText: { color: "#FFD7D2", fontSize: 12, fontWeight: "900" },
  progressTrack: {
    width: "100%",
    height: 8,
    borderRadius: 99,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,.16)",
    marginTop: 18,
  },
  progressFill: {
    height: 8,
    borderRadius: 99,
    backgroundColor: C.cyan,
  },
  generationPage: {
    minHeight: 620,
    paddingTop: 6,
    gap: 12,
  },
  generationHero: {
    borderRadius: 24,
    backgroundColor: "rgba(18,25,54,.86)",
    borderWidth: 1,
    borderColor: "rgba(142,162,255,.20)",
    padding: 18,
  },
  generationKicker: { color: C.purple, fontSize: 10, fontWeight: "900", marginBottom: 6 },
  generationTitle: { color: C.ink, fontSize: 24, lineHeight: 31, fontWeight: "900" },
  generationSub: { color: C.muted, fontSize: 12, lineHeight: 19, fontWeight: "700", marginTop: 6 },
  generationProgressCard: {
    minHeight: 260,
    borderRadius: 26,
    backgroundColor: "rgba(18,25,54,.76)",
    borderWidth: 1,
    borderColor: "rgba(142,162,255,.18)",
    padding: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: C.purple,
    shadowOpacity: 0.20,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
    elevation: 9,
  },
  generationRing: {
    width: 148,
    height: 148,
    borderRadius: 74,
    backgroundColor: "rgba(139,124,255,.14)",
    borderWidth: 3,
    borderColor: "rgba(142,162,255,.62)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
  },
  generationPct: { color: C.ink, fontSize: 34, fontWeight: "900" },
  generationPctSub: { color: C.muted, fontSize: 11, fontWeight: "900", marginTop: 4 },
  generationMetaCard: {
    borderRadius: 20,
    backgroundColor: "rgba(18,25,54,.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.09)",
    overflow: "hidden",
  },
  generationMetaRow: {
    minHeight: 48,
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,.08)",
  },
  generationMetaLabel: { color: C.muted, fontSize: 12, fontWeight: "900" },
  generationMetaValue: { color: C.ink, fontSize: 13, fontWeight: "900" },
  generationCancel: {
    height: 46,
    borderRadius: 16,
    backgroundColor: "rgba(255,176,166,.12)",
    borderWidth: 1,
    borderColor: "rgba(255,176,166,.28)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },

  taskPills: { flexDirection: "row", gap: 8, marginBottom: 10 },
  taskPill: {
    color: "#B8A4FF",
    fontSize: 11,
    fontWeight: "900",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(120,220,202,.10)",
    borderWidth: 1,
    borderColor: "rgba(120,220,202,.20)",
  },
  galleryHero: {
    backgroundColor: "rgba(18,25,54,.82)",
    borderWidth: 1,
    borderColor: "rgba(142,162,255,.18)",
    borderRadius: 22,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  galleryHeroTitle: { color: C.ink, fontSize: 18, fontWeight: "900" },
  galleryHeroSub: { color: C.muted, fontSize: 12, fontWeight: "600", marginTop: 4 },
  filterRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  filterChip: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "rgba(18,25,54,.74)",
    borderWidth: 1,
    borderColor: C.hairSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  filterChipActive: { backgroundColor: "rgba(120,220,202,.14)", borderColor: "rgba(120,220,202,.34)" },
  filterText: { color: C.muted, fontSize: 12, fontWeight: "800" },
  filterTextActive: { color: C.purple, fontSize: 12, fontWeight: "900" },
  galleryEmpty: {
    minHeight: 180,
    borderRadius: 20,
    backgroundColor: "#12152A",
    borderWidth: 1,
    borderColor: C.hairSoft,
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    marginTop: 4,
  },
  galleryEmptyTitle: { color: C.ink, fontSize: 16, fontWeight: "900", marginTop: 10 },
  galleryEmptySub: { color: C.muted, fontSize: 12, fontWeight: "600", marginTop: 6, textAlign: "center", lineHeight: 18 },
  tileMeta: { position: "absolute", left: 12, right: 12, bottom: 12 },
  tileSub: { color: "rgba(255,255,255,.66)", fontSize: 10, fontWeight: "700", marginTop: 3 },
  profileMenu: { gap: 10, marginBottom: 14 },
  profileMenuRow: {
    minHeight: 70,
    borderRadius: 16,
    backgroundColor: "#12152A",
    borderWidth: 1,
    borderColor: C.hairSoft,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
  },
  profileMenuIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "rgba(120,220,202,.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  profileMenuTitle: { color: C.ink, fontSize: 14, fontWeight: "900" },
  profileMenuSub: { color: C.muted, fontSize: 11, fontWeight: "600", marginTop: 3 },
  warnText: {
    color: "#ffd0d6",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "800",
    marginTop: 8,
  },
  primary: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 92,
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.amber,
    shadowColor: "#78DCCA",
    shadowOpacity: 0.32,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 18 },
    elevation: 12,
    borderWidth: 1,
    borderColor: "rgba(120,220,202,.42)",
  },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "900" },
  primaryOff: {
    backgroundColor: "rgba(255,255,255,.18)",
    shadowOpacity: 0.05,
    borderColor: C.hairSoft,
  },
  primaryTextOff: { color: "rgba(255,255,255,.52)" },
  tabs: {
    backgroundColor: "rgba(11,15,33,.92)",
    borderWidth: 1,
    borderColor: "rgba(142,162,255,.18)",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
    position: "absolute",
    bottom: Platform.OS === "ios" ? 18 : 14,
    height: 58,
    borderRadius: 20,
    padding: 5,
    flexDirection: "row",
    gap: 4,
  },
  tab: {
    flex: 1,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  tabActive: { backgroundColor: "rgba(139,124,255,.18)" },
  tabText: { color: "rgba(237,239,247,.48)", fontSize: 9, fontWeight: "700" },
  tabTextActive: { color: "#AEBBFF", fontSize: 9, fontWeight: "800" },
  galleryHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  galleryTitle: { color: C.ink, fontSize: 20, fontWeight: "900" },
  smallBtn: {
    ...plain,
    borderRadius: 999,
    paddingHorizontal: 12,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  smallBtnText: { color: C.ink, fontSize: 12, fontWeight: "900" },
  emptyText: {
    color: C.muted,
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
    marginTop: 60,
  },
  masonry: { flexDirection: "row", flexWrap: "wrap", gap: 11 },
  tile: {
    width: "48%",
    minHeight: 158,
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(142,162,255,.16)",
    backgroundColor: "rgba(18,25,54,.72)",
  },
  tileTall: { minHeight: 214 },
  tileImg: { width: "100%", height: "100%", position: "absolute" },
  tileShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,.22)",
  },
  tileText: {
    position: "absolute",
    left: 12,
    bottom: 12,
    color: "#fff",
    fontSize: 11,
    fontWeight: "900",
  },
  tileEdit: {
    position: "absolute",
    right: 10,
    top: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(120,220,202,.78)",
  },

  profileHeader: {
    backgroundColor: "#10171F",
    borderWidth: 1,
    borderColor: "rgba(120,220,202,.16)",
    borderRadius: 22,
    padding: 18,
    alignItems: "center",
    marginBottom: 14,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(120,220,202,.14)",
    borderWidth: 1,
    borderColor: "rgba(120,220,202,.34)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  avatarText: { color: C.purple, fontSize: 26, fontWeight: "900" },
  profileName: { color: C.ink, fontSize: 18, fontWeight: "800" },
  profileMeta: { color: C.muted, fontSize: 12, fontWeight: "600", marginTop: 4 },
  profileStats: { flexDirection: "row", gap: 8, marginTop: 14, width: "100%" },
  profileStat: {
    flex: 1,
    minHeight: 58,
    borderRadius: 14,
    backgroundColor: "#17212B",
    borderWidth: 1,
    borderColor: C.hairSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  profileStatNum: { color: C.ink, fontSize: 15, fontWeight: "900" },
  profileStatLabel: { color: C.muted, fontSize: 10, fontWeight: "700", marginTop: 3 },
  statusStrip: {
    backgroundColor: "#10171F",
    borderWidth: 1,
    borderColor: C.hairSoft,
    minHeight: 66,
    borderRadius: 16,
    paddingHorizontal: 15,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  statusTitle: { color: C.ink, fontSize: 14, fontWeight: "900" },
  statusSub: {
    color: C.muted,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 5,
    maxWidth: 230,
  },
  statusAction: {
    backgroundColor: C.amber,
    height: 36,
    borderRadius: 18,
    paddingHorizontal: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  statusActionText: { color: "#10131a", fontSize: 12, fontWeight: "900" },
  settingsCard: { backgroundColor: "#10171F", borderWidth: 1, borderColor: C.hairSoft, borderRadius: 22, overflow: "hidden", padding: 0 },
  configHero: {
    minHeight: 96,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,.10)",
  },
  configHeroAction: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 0 },
  configKicker: { color: C.purple, fontSize: 10, fontWeight: "900", marginBottom: 5 },
  configTitle: { color: C.ink, fontSize: 20, fontWeight: "900" },
  configSub: { color: C.muted, fontSize: 11, lineHeight: 17, fontWeight: "700", marginTop: 5, maxWidth: 210 },
  configStats: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,.10)",
  },
  configToolbar: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,.10)",
  },
  configAction: {
    height: 42,
    borderRadius: 15,
    backgroundColor: C.purple,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 12,
  },
  configActionText: { color: C.bg, fontSize: 13, fontWeight: "900" },
  settingsRow: {
    minHeight: 74,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,.11)",
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: C.ink, fontSize: 14, fontWeight: "900" },
  rowSub: {
    color: C.muted,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 4,
    maxWidth: "100%",
    lineHeight: 16,
  },
  editText: { color: "#fff1bd", fontSize: 12, fontWeight: "900" },
  settingsBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,.11)",
  },
  presets: { flexDirection: "row", gap: 8, marginTop: 12, marginBottom: 4 },
  preset: {
    ...plain,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  presetText: { color: C.ink, fontSize: 12, fontWeight: "900" },
  field: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 10 },
  fieldLabel: { width: 44, color: C.muted, fontSize: 12, fontWeight: "900" },
  fieldInput: {
    flex: 1,
    minHeight: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.hairSoft,
    backgroundColor: "rgba(255,255,255,.08)",
    paddingHorizontal: 11,
    color: C.ink,
    fontSize: 14,
  },
  plazaModalHeader: {
    paddingTop: Platform.OS === "ios" ? 14 : 8,
    paddingHorizontal: 18,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,.10)",
  },
  plazaModalKicker: { color: C.purple, fontSize: 10, fontWeight: "900", marginBottom: 5 },
  plazaModalTitle: { color: C.ink, fontSize: 22, fontWeight: "900" },
  modalCloseSmall: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#10171F",
    borderWidth: 1,
    borderColor: C.hairSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  plazaModalBody: {
    padding: 18,
    paddingBottom: 36,
    gap: 12,
  },
  externalPlazaCard: {
    minHeight: 76,
    borderRadius: 18,
    backgroundColor: "rgba(120,220,202,.08)",
    borderWidth: 1,
    borderColor: "rgba(120,220,202,.22)",
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  externalPlazaTitle: { color: C.ink, fontSize: 15, fontWeight: "900" },
  externalPlazaSub: { color: C.muted, fontSize: 11, lineHeight: 16, fontWeight: "700", marginTop: 5, maxWidth: 280 },
  plazaItem: {
    borderRadius: 18,
    backgroundColor: "#10171F",
    borderWidth: 1,
    borderColor: C.hairSoft,
    padding: 14,
  },
  plazaItemTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  plazaItemTag: {
    color: C.bg,
    backgroundColor: C.amber,
    overflow: "hidden",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    fontSize: 10,
    fontWeight: "900",
  },
  plazaItemStyle: { color: C.purple, fontSize: 11, fontWeight: "900" },
  plazaItemTitle: { color: C.ink, fontSize: 16, fontWeight: "900" },
  plazaItemPrompt: { color: C.muted, fontSize: 12, lineHeight: 19, fontWeight: "700", marginTop: 8 },
  modalSafe: { flex: 1, backgroundColor: "#070a10" },
  modalClose: {
    position: "absolute",
    top: Platform.OS === "ios" ? 56 : 16,
    right: 16,
    zIndex: 10,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(0,0,0,.42)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalImg: { flex: 1, width: "100%" },
  modalPanel: {
    ...glass,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 18,
    borderBottomWidth: 0,
  },
  modalTitle: {
    color: C.ink,
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 8,
  },
  modalPrompt: { color: C.muted, lineHeight: 20 },
  modalActions: { flexDirection: "row", gap: 9, marginTop: 14 },
  modalAction: {
    ...plain,
    flex: 1,
    height: 48,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  modalActionText: { color: C.ink, fontSize: 13, fontWeight: "900" },
  modalActionHot: {
    flex: 1,
    height: 48,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.86)",
  },
  modalActionHotText: { color: "#11131a", fontSize: 13, fontWeight: "900" },
});
