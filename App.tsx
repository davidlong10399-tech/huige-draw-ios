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
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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

type Mode = "generate" | "edit";
type Tab = "create" | "gallery" | "settings";
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
};

const CONFIG_KEY = "huige-draw-direct-config-v4";
const LEGACY_CONFIG_KEY = "huige-draw-direct-config-v3";
const HISTORY_KEY = "huige-draw-history-v3";
const MAX_HISTORY = 50;
const stylesList = [
  "商业海报",
  "电影感",
  "真实摄影",
  "国潮",
  "产品摄影",
  "赛博朋克",
];
const stylePrompts: Record<string, string> = {
  商业海报: "商业海报设计，强视觉冲击，高级排版，真实光影",
  电影感: "电影感构图，戏剧化光影，浅景深，色彩分级",
  真实摄影: "真实摄影，自然光影，细节丰富，高分辨率",
  国潮: "国潮东方美学，红金色调，精致纹样",
  产品摄影: "高端产品摄影，棚拍灯光，极简背景",
  赛博朋克: "雨夜霓虹，赛博朋克城市，湿润地面反光，高细节",
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  const [hydrated, setHydrated] = useState(false);
  const [imageApiBase, setImageApiBase] = useState(DEFAULT_API_BASE);
  const [imageApiKey, setImageApiKey] = useState("");
  const [imageModel, setImageModel] = useState(DEFAULT_IMAGE_MODEL);
  const [textApiBase, setTextApiBase] = useState(DEFAULT_API_BASE);
  const [textApiKey, setTextApiKey] = useState("");
  const [textModel, setTextModel] = useState(DEFAULT_ASSISTANT_MODEL);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedImageSettings, setExpandedImageSettings] = useState(false);
  const [expandedTextSettings, setExpandedTextSettings] = useState(false);
  const settingsLayoutInitialized = useRef(false);
  const [tab, setTab] = useState<Tab>("create");
  const [connected, setConnected] = useState("请填写 API Key 后测试连接");
  const [mode, setMode] = useState<Mode>("generate");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1:1");
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
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

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
          const legacyBase = c.apiBase || DEFAULT_API_BASE;
          const legacyKey = typeof c.apiKey === "string" ? c.apiKey : "";
          setImageApiBase(c.imageApiBase || legacyBase);
          setImageApiKey(
            typeof c.imageApiKey === "string" ? c.imageApiKey : legacyKey,
          );
          setImageModel(c.imageModel || DEFAULT_IMAGE_MODEL);
          setTextApiBase(c.textApiBase || legacyBase);
          setTextApiKey(
            typeof c.textApiKey === "string" ? c.textApiKey : legacyKey,
          );
          setTextModel(
            c.textModel || c.assistantModel || DEFAULT_ASSISTANT_MODEL,
          );
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
    setExpandedImageSettings(!imageConfigured);
    setExpandedTextSettings(!textConfigured);
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

  async function runGenerate() {
    if (!imageApiKey.trim())
      return Alert.alert("缺少生图 API Key", "请先在设置里填写生图 API Key。");
    if (!fullPrompt.trim()) return Alert.alert("先输入提示词");
    if (mode === "edit" && !refs.length)
      return Alert.alert(
        "缺少参考图",
        '以图改图必须先上传参考图。请先点"上传参考图"，或切回"文生图"。',
      );
    setGenerating(true);
    startProgress(mode === "edit" ? "正在以图改图" : "正在生成图片");
    try {
      const started = Date.now();
      const raw =
        mode === "edit"
          ? await editImage(imageConfig, {
              prompt: fullPrompt,
              size,
              images: refs,
            })
          : await generateImage(imageConfig, { prompt: fullPrompt, size });
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
      setSelected(saved);
    } catch (e: any) {
      stopProgress();
      Alert.alert("生成失败", friendlyErrorMessage(e));
    } finally {
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
          <View style={styles.top}>
            <View>
              <Text style={styles.brand}>画刃</Text>
              <Text style={styles.brandSub}>
                快速生成 · 快速改图 · 快速沉淀
              </Text>
            </View>
            <Pressable style={styles.pill} onPress={() => setTab("settings")}>
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
          {tab === "create" && (
            <>
              <View style={styles.modebar}>
                {(["generate", "edit"] as Mode[]).map((m) => (
                  <Pressable
                    key={m}
                    style={[styles.mode, m === mode && styles.modeActive]}
                    onPress={() => setMode(m)}
                  >
                    <Text
                      style={
                        m === mode ? styles.modeTextActive : styles.modeText
                      }
                    >
                      {m === "generate" ? "文生图" : "以图改图"}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.promptCard}>
                <View style={styles.promptHead}>
                  <Text style={styles.promptLabel}>PROMPT</Text>
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
                  style={styles.promptInput}
                  multiline
                  placeholder="一张 618 足浴盆电商主图，白色产品置于明亮浴室环境，干净高级，暖色灯光，商业摄影质感。"
                  placeholderTextColor="rgba(247,249,255,.45)"
                  value={prompt}
                  onChangeText={setPrompt}
                  editable={!generating && !optimizing}
                />
              </View>
              {!!assistantMsg && (
                <View style={styles.assistCard}>
                  <View style={styles.assistHead}>
                    <Ionicons name="sparkles" size={14} color="#bfe9ff" />
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
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
              >
                {["自动比例", "1:1", "9:16", "16:9"].map((s) => {
                  const active =
                    (s === "自动比例" && size === "1:1") || size === s;
                  return (
                    <Pressable
                      key={s}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => setSize(s === "自动比例" ? "1:1" : s)}
                    >
                      <Text
                        style={active ? styles.chipTextActive : styles.chipText}
                      >
                        {s}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
              >
                {stylesList.map((s) => (
                  <Pressable
                    key={s}
                    style={[styles.chip, style === s && styles.chipActive]}
                    onPress={() => setStyle(s)}
                  >
                    <Text
                      style={
                        style === s ? styles.chipTextActive : styles.chipText
                      }
                    >
                      {s}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              <View style={styles.tools}>
                <Pressable style={styles.tool} onPress={pickImages}>
                  <Ionicons name="image-outline" size={22} color="#fff" />
                  <Text style={styles.toolText}>
                    {refs.length ? "参考图 " + refs.length + " 张" : "上传参考图"}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.tool, !prompt && styles.disabled]}
                  onPress={() => setPrompt("")}
                  disabled={!prompt}
                >
                  <Ionicons name="backspace-outline" size={22} color="#fff" />
                  <Text style={styles.toolText}>清空提示词</Text>
                </Pressable>
              </View>
              {!!refs.length && (
                <View style={styles.refStrip}>
                  {refs.map((r, i) => (
                    <Pressable
                      key={i}
                      onPress={() =>
                        setRefs(refs.filter((_, idx) => idx !== i))
                      }
                    >
                      <Image source={{ uri: r.uri }} style={styles.refThumb} />
                    </Pressable>
                  ))}
                </View>
              )}
              {!!progress && (
                <View style={styles.taskCard}>
                  <View style={styles.ring}>
                    <Text style={styles.pct}>
                      {Math.round(progress * 100)}%
                    </Text>
                    <Text style={styles.pctSub}>正在绘制</Text>
                  </View>
                  <Text style={styles.taskTitle}>
                    {progressText || "画面成型中"}
                  </Text>
                  <Text style={styles.taskSub}>
                    前台保持亮屏，完成后自动进入作品流。
                  </Text>
                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: (String(Math.round(progress * 100)) +
                            "%") as any,
                        },
                      ]}
                    />
                  </View>
                </View>
              )}
              {editBlocked && (
                <Text style={styles.warnText}>
                  以图改图需要先上传参考图，否则不会请求接口。
                </Text>
              )}
            </>
          )}
          {tab === "gallery" && (
            <View>
              <View style={styles.galleryHead}>
                <Text style={styles.galleryTitle}>作品流</Text>
                {!!results.length && (
                  <Pressable style={styles.smallBtn} onPress={clearHistory}>
                    <Text style={styles.smallBtnText}>清空</Text>
                  </Pressable>
                )}
              </View>
              {!results.length && (
                <Text style={styles.emptyText}>
                  {hydrated ? "暂无作品，先去创作一张吧" : "正在恢复作品流..."}
                </Text>
              )}
              <View style={styles.masonry}>
                {results.map((r, i) => (
                  <Pressable
                    key={r.id || r.url + "-" + i}
                    style={[styles.tile, i % 3 === 1 && styles.tileTall]}
                    onPress={() => setSelected(r)}
                  >
                    <Image
                      source={{ uri: r.localUri || r.url }}
                      style={styles.tileImg}
                    />
                    <View style={styles.tileShade} />
                    <Text style={styles.tileText}>
                      {r.elapsed ? r.elapsed + "s" : "作品"}
                    </Text>
                    <Pressable
                      style={styles.tileEdit}
                      onPress={() => editAgain(r)}
                    >
                      <Ionicons
                        name="create-outline"
                        size={15}
                        color="#10131a"
                      />
                    </Pressable>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          {tab === "settings" && (
            <>
              <View style={styles.statusStrip}>
                <View>
                  <Text style={styles.statusTitle}>接口配置</Text>
                  <Text style={styles.statusSub}>{connected}</Text>
                </View>
                <Pressable style={styles.statusAction} onPress={checkHealth}>
                  <Text style={styles.statusActionText}>测试</Text>
                </Pressable>
              </View>
              <View style={styles.settingsCard}>
                <Pressable
                  style={styles.settingsRow}
                  onPress={() => setExpandedImageSettings((v) => !v)}
                >
                  <View>
                    <Text style={styles.rowTitle}>生图接口</Text>
                    <Text style={styles.rowSub}>
                      {imageConfigured
                        ? imageModel + " · " + maskedImageKey
                        : "文生图 / 以图改图，待配置"}
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
                  <View>
                    <Text style={styles.rowTitle}>文本接口</Text>
                    <Text style={styles.rowSub}>
                      {textConfigured
                        ? textModel + " · " + maskedTextKey
                        : "AI 提示词优化，待配置"}
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
              </View>
            </>
          )}
        </ScrollView>
        {tab === "create" && (
          <Pressable
            style={[styles.primary, generateDisabled && styles.primaryOff]}
            onPress={runGenerate}
            disabled={generateDisabled}
          >
            <Text
              style={[
                styles.primaryText,
                generateDisabled && styles.primaryTextOff,
              ]}
            >
              {!hydrated
                ? "正在恢复数据..."
                : generating
                  ? "生成中..."
                  : editBlocked
                    ? "请先上传参考图"
                    : "开始生成"}
            </Text>
          </Pressable>
        )}
        <View style={styles.tabs}>
          {(
            [
              ["create", "创作"],
              ["gallery", "作品"],
              ["settings", "设置"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <Pressable
              key={key}
              style={[styles.tab, tab === key && styles.tabActive]}
              onPress={() => setTab(key)}
            >
              <Text style={tab === key ? styles.tabTextActive : styles.tabText}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const C = {
  ink: "#f7f9ff",
  muted: "rgba(247,249,255,.68)",
  hair: "rgba(255,255,255,.26)",
  hairSoft: "rgba(255,255,255,.13)",
  glass: "rgba(255,255,255,.13)",
  amber: "#ffd166",
  green: "#66e0a3",
  bg: "#08101b",
};
const glass = {
  backgroundColor: C.glass,
  borderWidth: 1,
  borderColor: C.hair,
  shadowColor: "#000",
  shadowOpacity: 0.24,
  shadowRadius: 28,
  shadowOffset: { width: 0, height: 16 },
  elevation: 8,
};
const plain = {
  backgroundColor: "rgba(255,255,255,.105)",
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
  cyan: { left: -80, top: -54, backgroundColor: "rgba(131,232,255,.24)" },
  amber: { right: -92, top: 88, backgroundColor: "rgba(255,209,102,.23)" },
  orange: { right: -70, bottom: 52, backgroundColor: "rgba(255,122,48,.17)" },
  sheen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,.018)",
  },
  content: {
    paddingTop: Platform.OS === "ios" ? 22 : 18,
    paddingHorizontal: 18,
    paddingBottom: 176,
  },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 24,
  },
  brand: { color: C.ink, fontSize: 25, lineHeight: 28, fontWeight: "900" },
  brandSub: { color: C.muted, fontSize: 11, fontWeight: "800", marginTop: 6 },
  pill: {
    ...plain,
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
  modebar: {
    ...plain,
    marginBottom: 16,
    padding: 5,
    borderRadius: 20,
    flexDirection: "row",
    gap: 5,
  },
  mode: {
    flex: 1,
    height: 40,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  modeActive: { backgroundColor: "rgba(255,255,255,.82)" },
  modeText: { color: "rgba(255,255,255,.66)", fontSize: 13, fontWeight: "900" },
  modeTextActive: { color: "#10131a", fontSize: 13, fontWeight: "900" },
  promptCard: {
    ...glass,
    minHeight: 220,
    borderRadius: 26,
    padding: 17,
    marginBottom: 13,
  },
  promptHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 13,
  },
  promptLabel: {
    color: "rgba(255,255,255,.76)",
    fontSize: 12,
    fontWeight: "900",
  },
  magic: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
  },
  magicText: { color: "#fff3c2", fontSize: 12, fontWeight: "900" },
  magicTextBlue: { color: "#bfe9ff" },
  headActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  assistCard: {
    ...glass,
    borderRadius: 22,
    padding: 15,
    marginBottom: 13,
    borderColor: "rgba(150,210,255,.35)",
  },
  assistHead: { flexDirection: "row", alignItems: "center", gap: 7 },
  assistTitle: {
    flex: 1,
    color: "#bfe9ff",
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
    backgroundColor: "rgba(150,210,255,.16)",
    borderWidth: 1,
    borderColor: "rgba(150,210,255,.34)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  assistChipText: { color: "#d6efff", fontSize: 12, fontWeight: "900" },
  promptInput: {
    flex: 1,
    minHeight: 154,
    color: "#fff",
    fontSize: 17,
    lineHeight: 28,
    fontWeight: "600",
    textAlignVertical: "top",
    padding: 0,
  },
  chipRow: { gap: 8, paddingRight: 18, marginBottom: 13 },
  chip: {
    ...plain,
    height: 35,
    borderRadius: 999,
    paddingHorizontal: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: {
    backgroundColor: "rgba(255,255,255,.84)",
    borderColor: "transparent",
  },
  chipText: { color: "rgba(255,255,255,.76)", fontSize: 12, fontWeight: "900" },
  chipTextActive: { color: "#11131a", fontSize: 12, fontWeight: "900" },
  tools: { flexDirection: "row", gap: 9, marginBottom: 13 },
  tool: {
    ...plain,
    flex: 1,
    height: 68,
    borderRadius: 22,
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
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.hair,
  },
  taskCard: {
    ...glass,
    minHeight: 248,
    borderRadius: 32,
    padding: 22,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  ring: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: "rgba(12,18,28,.62)",
    borderWidth: 1,
    borderColor: C.hair,
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
    backgroundColor: "rgba(255,255,255,.92)",
  },
  warnText: {
    color: "#ffd0d6",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "800",
    marginTop: 8,
  },
  primary: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 88,
    height: 58,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.amber,
    shadowColor: "#ffb446",
    shadowOpacity: 0.32,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 18 },
    elevation: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.6)",
  },
  primaryText: { color: "#11131a", fontSize: 16, fontWeight: "900" },
  primaryOff: {
    backgroundColor: "rgba(255,255,255,.18)",
    shadowOpacity: 0.05,
    borderColor: C.hairSoft,
  },
  primaryTextOff: { color: "rgba(255,255,255,.52)" },
  tabs: {
    ...glass,
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 22,
    height: 50,
    borderRadius: 22,
    padding: 5,
    flexDirection: "row",
    gap: 5,
  },
  tab: {
    flex: 1,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  tabActive: { backgroundColor: "rgba(255,255,255,.84)" },
  tabText: { color: "rgba(255,255,255,.56)", fontSize: 12, fontWeight: "900" },
  tabTextActive: { color: "#10131a", fontSize: 12, fontWeight: "900" },
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
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.hair,
    backgroundColor: "rgba(255,255,255,.10)",
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
    backgroundColor: "rgba(255,255,255,.84)",
  },
  statusStrip: {
    ...glass,
    minHeight: 66,
    borderRadius: 24,
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
    backgroundColor: "rgba(255,255,255,.84)",
    height: 36,
    borderRadius: 18,
    paddingHorizontal: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  statusActionText: { color: "#10131a", fontSize: 12, fontWeight: "900" },
  settingsCard: { ...glass, borderRadius: 26, overflow: "hidden", padding: 0 },
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
  rowTitle: { color: C.ink, fontSize: 14, fontWeight: "900" },
  rowSub: {
    color: C.muted,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 4,
    maxWidth: 245,
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
