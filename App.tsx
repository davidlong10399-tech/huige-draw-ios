import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { editImage, generateImage, health, DEFAULT_API_BASE, DEFAULT_ASSISTANT_MODEL, DEFAULT_IMAGE_MODEL, DirectApiConfig, GenerateResult, optimizePrompt, RefImage } from './src/lib/api';

type Mode = 'generate' | 'edit';
type Tab = 'create' | 'gallery' | 'settings';
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

const CONFIG_KEY = 'huige-draw-direct-config-v4';
const LEGACY_CONFIG_KEY = 'huige-draw-direct-config-v3';
const HISTORY_KEY = 'huige-draw-history-v3';
const MAX_HISTORY = 50;
const stylesList = ['商业海报', '电影感', '真实摄影', '国潮', '产品摄影', '赛博朋克'];
const stylePrompts: Record<string, string> = {
  商业海报: '商业海报设计，强视觉冲击，高级排版，真实光影',
  电影感: '电影感构图，戏剧化光影，浅景深，色彩分级',
  真实摄影: '真实摄影，自然光影，细节丰富，高分辨率',
  国潮: '国潮东方美学，红金色调，精致纹样',
  产品摄影: '高端产品摄影，棚拍灯光，极简背景',
  赛博朋克: '雨夜霓虹，赛博朋克城市，湿润地面反光，高细节',
};

function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }
function makeId() { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function makeUploadableRef(asset: { uri: string; fileName?: string | null; mimeType?: string | null }, index = 0): Promise<RefImage> {
  const converted = await ImageManipulator.manipulateAsync(asset.uri, [], { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG });
  const baseName = asset.fileName?.replace(/\.[^.]+$/, '') || `ref-${Date.now()}-${index}`;
  return { name: `${baseName}.jpg`, uri: converted.uri, mimeType: 'image/jpeg' };
}

async function persistImage(result: GenerateResult) {
  const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!baseDir) return result;
  const filename = `huaren-${result.id || makeId()}.png`;
  const localUri = `${baseDir}${filename}`;
  if (result.url.startsWith('data:image/')) {
    const base64 = result.url.split(',')[1] || '';
    await FileSystem.writeAsStringAsync(localUri, base64, { encoding: FileSystem.EncodingType.Base64 });
  } else if (/^https?:/i.test(result.url)) {
    const response = await fetch(result.url);
    if (!response.ok) throw new Error(`图片下载失败 HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);
    await FileSystem.writeAsStringAsync(localUri, base64, { encoding: FileSystem.EncodingType.Base64 });
  } else if (result.url.startsWith('file:')) {
    if (result.url !== localUri) await FileSystem.copyAsync({ from: result.url, to: localUri }).catch(() => {});
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
    if (typeof item.url === 'string' && (item.url.startsWith('data:image/') || /^https?:/i.test(item.url))) {
      next.push(item);
    }
  }
  return next.slice(0, MAX_HISTORY);
}

export default function App() {
  const [hydrated, setHydrated] = useState(false);
  const [imageApiBase, setImageApiBase] = useState(DEFAULT_API_BASE);
  const [imageApiKey, setImageApiKey] = useState('');
  const [imageModel, setImageModel] = useState(DEFAULT_IMAGE_MODEL);
  const [textApiBase, setTextApiBase] = useState(DEFAULT_API_BASE);
  const [textApiKey, setTextApiKey] = useState('');
  const [textModel, setTextModel] = useState(DEFAULT_ASSISTANT_MODEL);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedImageSettings, setExpandedImageSettings] = useState(false);
  const [expandedTextSettings, setExpandedTextSettings] = useState(false);
  const settingsLayoutInitialized = useRef(false);
  const [tab, setTab] = useState<Tab>('create');
  const [connected, setConnected] = useState('请填写 API Key 后测试连接');
  const [mode, setMode] = useState<Mode>('generate');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1:1');
  const [style, setStyle] = useState('商业海报');
  const [refs, setRefs] = useState<RefImage[]>([]);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [optimizing, setOptimizing] = useState(false);
  const [results, setResults] = useState<GenerateResult[]>([]);
  const [selected, setSelected] = useState<GenerateResult | null>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const imageConfig: DirectApiConfig = useMemo(() => ({ apiBase: imageApiBase, apiKey: imageApiKey, imageModel, assistantModel: textModel }), [imageApiBase, imageApiKey, imageModel, textModel]);
  const textConfig: DirectApiConfig = useMemo(() => ({ apiBase: textApiBase, apiKey: textApiKey, imageModel, assistantModel: textModel }), [textApiBase, textApiKey, imageModel, textModel]);
  const fullPrompt = useMemo(() => [prompt.trim(), stylePrompts[style] || ''].filter(Boolean).join('，'), [prompt, style]);
  const maskedImageKey = imageApiKey ? `${imageApiKey.slice(0, 6)}****${imageApiKey.slice(-4)}` : '未填写';
  const maskedTextKey = textApiKey ? `${textApiKey.slice(0, 6)}****${textApiKey.slice(-4)}` : '未填写';
  const editBlocked = mode === 'edit' && refs.length === 0;
  const generateDisabled = generating || optimizing || editBlocked || !hydrated;
  const activeTask = generating || optimizing;
  const imageConfigured = !!imageApiBase.trim() && !!imageApiKey.trim() && !!imageModel.trim();
  const textConfigured = !!textApiBase.trim() && !!textApiKey.trim() && !!textModel.trim();
  useKeepAwake(activeTask ? 'huaren-active-task' : undefined);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(CONFIG_KEY) || await AsyncStorage.getItem(LEGACY_CONFIG_KEY);
        if (saved && alive) {
          const c = JSON.parse(saved) as SavedConfig;
          const legacyBase = c.apiBase || DEFAULT_API_BASE;
          const legacyKey = typeof c.apiKey === 'string' ? c.apiKey : '';
          setImageApiBase(c.imageApiBase || legacyBase);
          setImageApiKey(typeof c.imageApiKey === 'string' ? c.imageApiKey : legacyKey);
          setImageModel(c.imageModel || DEFAULT_IMAGE_MODEL);
          setTextApiBase(c.textApiBase || legacyBase);
          setTextApiKey(typeof c.textApiKey === 'string' ? c.textApiKey : legacyKey);
          setTextModel(c.textModel || c.assistantModel || DEFAULT_ASSISTANT_MODEL);
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
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!hydrated || settingsLayoutInitialized.current) return;
    settingsLayoutInitialized.current = true;
    setExpandedImageSettings(!imageConfigured);
    setExpandedTextSettings(!textConfigured);
  }, [hydrated, imageConfigured, textConfigured]);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(CONFIG_KEY, JSON.stringify({ imageApiBase, imageApiKey, imageModel, textApiBase, textApiKey, textModel, showSettings })).catch(() => {});
  }, [hydrated, imageApiBase, imageApiKey, imageModel, textApiBase, textApiKey, textModel, showSettings]);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(results.slice(0, MAX_HISTORY))).catch(() => {});
  }, [hydrated, results]);

  useEffect(() => () => {
    if (progressTimer.current) clearInterval(progressTimer.current);
  }, []);

  function startProgress(label: string) {
    setProgress(0.08);
    setProgressText(label);
    if (progressTimer.current) clearInterval(progressTimer.current);
    progressTimer.current = setInterval(() => {
      setProgress(p => Math.min(0.92, p + (p < 0.45 ? 0.06 : p < 0.75 ? 0.025 : 0.01)));
    }, 900);
  }

  function stopProgress(label = '') {
    if (progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
    setProgress(0);
    setProgressText(label);
  }

  function friendlyErrorMessage(error: any) {
    const message = error?.message || String(error);
    if (/504|timeout|timed out|Gateway Timeout/i.test(message)) {
      return '服务商超时(504)。这不是 App 卡住，请稍后重试或切换中转站/模型。';
    }
    if (/Network request failed/i.test(message)) {
      return '网络请求失败。请保持前台/网络稳定后重试。';
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
    stopProgress('');
  }

  const checkHealth = useCallback(async () => {
    if (!imageApiKey.trim()) {
      setConnected('请先填写生图 API Key');
      return;
    }
    setConnected('测试生图连接中...');
    try {
      const h = await health(imageConfig);
      setConnected(`生图接口正常 · ${h.imageModel || imageModel}`);
    } catch (e: any) {
      setConnected(`生图连接失败: ${e.message}`);
    }
  }, [imageApiKey, imageConfig, imageModel]);

  async function pickImages() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('需要相册权限', '请选择参考图用于图像编辑。');
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, quality: 0.92 });
    if (r.canceled) return;
    const next = [...refs];
    for (const asset of r.assets) {
      if (next.length >= 4) break;
      if (asset.uri) next.push(await makeUploadableRef(asset, next.length));
    }
    setRefs(next);
    if (next.length) setMode('edit');
  }

  async function runOptimize() {
    if (!textApiKey.trim()) return Alert.alert('缺少文本 API Key', '请先在设置里填写提示词优化 API Key。');
    if (!prompt.trim()) return Alert.alert('先输入提示词');
    setOptimizing(true);
    startProgress('正在优化提示词');
    try {
      const r = await optimizePrompt(textConfig, prompt);
      setPrompt(r.optimized);
      await finishProgress('优化完成');
    } catch (e: any) {
      stopProgress();
      Alert.alert('优化失败', friendlyErrorMessage(e));
    } finally {
      setOptimizing(false);
    }
  }

  async function runGenerate() {
    if (!imageApiKey.trim()) return Alert.alert('缺少生图 API Key', '请先在设置里填写生图 API Key。');
    if (!fullPrompt.trim()) return Alert.alert('先输入提示词');
    if (mode === 'edit' && !refs.length) return Alert.alert('缺少参考图', '以图改图必须先上传参考图。请先点"上传参考图"，或切回"文生图"。');
    setGenerating(true);
    startProgress(mode === 'edit' ? '正在以图改图' : '正在生成图片');
    try {
      const started = Date.now();
      const raw = mode === 'edit'
        ? await editImage(imageConfig, { prompt: fullPrompt, size, images: refs })
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
        Alert.alert('生成成功，但本地保存失败', saveError?.message || String(saveError));
      }
      setResults(prev => [saved, ...prev].slice(0, MAX_HISTORY));
      await finishProgress('生成完成');
      setSelected(saved);
    } catch (e: any) {
      stopProgress();
      Alert.alert('生成失败', friendlyErrorMessage(e));
    } finally {
      setGenerating(false);
    }
  }

  async function saveToAlbum(item: GenerateResult) {
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) return Alert.alert('需要相册权限', '请允许保存图片到相册。');
      const uri = item.localUri || (await persistImage(item)).localUri;
      if (!uri) throw new Error('图片文件不存在');
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert('已保存', '图片已保存到系统相册。');
    } catch (e: any) {
      Alert.alert('保存失败', e.message || String(e));
    }
  }

  async function editAgain(item: GenerateResult) {
    try {
      const saved = item.localUri ? item : await persistImage(item);
      const uri = saved.localUri || saved.url;
      if (!uri.startsWith('file:')) throw new Error('无法把这张图转换成本地参考图文件');
      setRefs([{ name: 'generated-reference.png', uri, mimeType: 'image/png' }]);
      setMode('edit');
      setTab('create');
      setPrompt('在这张图基础上，');
      setSelected(null);
    } catch (e: any) {
      Alert.alert('再次修改失败', e.message || String(e));
    }
  }

  async function copyPrompt(text?: string) {
    const value = (text || '').trim();
    if (!value) return Alert.alert('没有可复制的提示词');
    await Clipboard.setStringAsync(value);
    Alert.alert('已复制', '提示词已复制到剪贴板。');
  }

  function clearHistory() {
    Alert.alert('清空历史', '会清空 App 内作品流记录，不删除系统相册。', [
      { text: '取消' },
      { text: '清空', style: 'destructive', onPress: () => setResults([]) },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* ── Header ── */}
          <View style={styles.header}>
            <View style={styles.logo}>
              <Ionicons name="flash" size={26} color="#0a0a0f" />
            </View>
            <View style={styles.flex}>
              <Text style={styles.title}>画刃</Text>
              <Text style={styles.sub}>AI 出图工作台</Text>
            </View>
            <View style={[styles.statusDot, imageConfigured ? styles.statusDotOk : styles.statusDotOff]} />
          </View>

          {/* ═══════ CREATE TAB ═══════ */}
          {tab === 'create' && (<>
            {/* Mode toggle card */}
            <View style={styles.glassCard}>
              <View style={styles.modeRow}>
                <Pressable style={[styles.modeBtn, mode === 'generate' && styles.modeBtnActive]} onPress={() => setMode('generate')}>
                  <Ionicons name="color-wand-outline" size={18} color={mode === 'generate' ? '#0a0a0f' : '#8e8e9a'} />
                  <Text style={mode === 'generate' ? styles.modeBtnTextActive : styles.modeBtnText}>文生图</Text>
                </Pressable>
                <Pressable style={[styles.modeBtn, mode === 'edit' && styles.modeBtnActive]} onPress={() => setMode('edit')}>
                  <Ionicons name="images-outline" size={18} color={mode === 'edit' ? '#0a0a0f' : '#8e8e9a'} />
                  <Text style={mode === 'edit' ? styles.modeBtnTextActive : styles.modeBtnText}>以图改图</Text>
                </Pressable>
              </View>

              {/* BIG prompt */}
              <TextInput
                style={styles.promptInput}
                multiline
                placeholder="描述你想生成的画面..."
                placeholderTextColor="#5e5e6a"
                value={prompt}
                onChangeText={setPrompt}
                editable={!generating && !optimizing}
              />

              {/* Optimize + Clear */}
              <View style={styles.inlineActions}>
                <Pressable style={[styles.inlineAction, optimizing && styles.disabled]} onPress={runOptimize} disabled={optimizing}>
                  <Ionicons name="sparkles" size={16} color="#0a0a0f" />
                  <Text style={styles.inlineActionText}>{optimizing ? '优化中...' : 'AI 优化提示词'}</Text>
                </Pressable>
                <Pressable style={styles.inlineGhost} onPress={() => setPrompt('')}>
                  <Text style={styles.inlineGhostText}>清空</Text>
                </Pressable>
              </View>
            </View>

            {/* Params card */}
            <View style={styles.glassCard}>
              <Text style={styles.sectionTitle}>比例</Text>
              <View style={styles.chips}>
                {['1:1', '9:16', '16:9'].map(s => (
                  <Pressable key={s} style={[styles.chip, size === s && styles.chipActive]} onPress={() => setSize(s)}>
                    <Text style={size === s ? styles.chipTextActive : styles.chipText}>{s}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.sectionTitle}>风格</Text>
              <View style={styles.chips}>
                {stylesList.map(s => (
                  <Pressable key={s} style={[styles.chip, style === s && styles.chipActive]} onPress={() => setStyle(s)}>
                    <Text style={style === s ? styles.chipTextActive : styles.chipText}>{s}</Text>
                  </Pressable>
                ))}
              </View>

              {/* Upload refs */}
              <Pressable style={styles.uploadZone} onPress={pickImages}>
                <Ionicons name="cloud-upload-outline" size={22} color={refs.length ? '#f4b63f' : '#5e5e6a'} />
                <Text style={styles.uploadText}>
                  {refs.length ? `已选 ${refs.length} 张参考图` : '上传参考图'}
                </Text>
                <Text style={styles.uploadSub}>
                  {refs.length ? '点击缩略图可移除' : '最多 4 张，用于以图改图'}
                </Text>
              </Pressable>

              {!!refs.length && (
                <View style={styles.refRow}>
                  {refs.map((r, i) => (
                    <Pressable key={i} onPress={() => setRefs(refs.filter((_, idx) => idx !== i))}>
                      <Image source={{ uri: r.uri }} style={styles.refThumb} />
                    </Pressable>
                  ))}
                </View>
              )}

              {/* Progress */}
              {!!progress && (
                <View style={styles.progressWrap}>
                  <View style={[styles.progressBar, { width: `${Math.round(progress * 100)}%` }]} />
                  <Text style={styles.progressText}>{progressText} · {Math.round(progress * 100)}%</Text>
                </View>
              )}

              {editBlocked && (
                <Text style={styles.warnText}>以图改图需要先上传参考图，否则不会请求接口。</Text>
              )}
            </View>

            {/* Generate CTA */}
            <Pressable style={[styles.generateBtn, generateDisabled && styles.disabled]} onPress={runGenerate} disabled={generateDisabled}>
              <Ionicons name="flash" size={20} color={generateDisabled ? '#5e5e6a' : '#0a0a0f'} />
              <Text style={[styles.generateBtnText, generateDisabled && styles.generateBtnTextOff]}>
                {!hydrated ? '正在恢复数据...' : generating ? '生成中...' : editBlocked ? '请先上传参考图' : '开始生成'}
              </Text>
            </Pressable>
          </>)}

          {/* ═══════ GALLERY TAB ═══════ */}
          {tab === 'gallery' && (
            <View style={styles.glassCard}>
              <View style={styles.rowBetween}>
                <Text style={styles.sectionTitle}>作品流</Text>
                {!!results.length && (
                  <Pressable style={styles.textBtn} onPress={clearHistory}>
                    <Text style={styles.textBtnText}>清空</Text>
                  </Pressable>
                )}
              </View>
              <Text style={styles.galleryHint}>点击看大图，可保存相册、复制提示词或再次修改</Text>
              {!results.length && (
                <Text style={styles.emptyText}>
                  {hydrated ? '暂无作品，先去创作一张吧' : '正在恢复作品流...'}
                </Text>
              )}
              <View style={styles.resultGrid}>
                {results.map((r, i) => (
                  <Pressable key={r.id || `${r.url}-${i}`} style={styles.resultCard} onPress={() => setSelected(r)}>
                    <Image source={{ uri: r.localUri || r.url }} style={styles.resultImg} />
                    <View style={styles.resultMeta}>
                      <Text style={styles.resultMetaText}>{r.elapsed ? `${r.elapsed}s` : ''}</Text>
                      <Pressable style={styles.resultEditBtn} onPress={() => editAgain(r)}>
                        <Ionicons name="create-outline" size={14} color="#f4b63f" />
                      </Pressable>
                    </View>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* ═══════ SETTINGS TAB ═══════ */}
          {tab === 'settings' && (<>
            {/* Connection status */}
            <View style={styles.glassCard}>
              <View style={styles.rowBetween}>
                <View style={styles.flex}>
                  <Text style={styles.sectionTitle}>接口状态</Text>
                  <View style={styles.statusGrid}>
                    <View style={styles.statusCell}>
                      <View style={[styles.statusLed, imageConfigured ? styles.statusLedOk : styles.statusLedOff]} />
                      <Text style={styles.statusCellLabel}>生图</Text>
                      <Text style={styles.statusCellValue}>{imageConfigured ? imageModel : '未配置'}</Text>
                      <Text style={styles.statusCellKey}>{maskedImageKey}</Text>
                    </View>
                    <View style={styles.statusCell}>
                      <View style={[styles.statusLed, textConfigured ? styles.statusLedOk : styles.statusLedOff]} />
                      <Text style={styles.statusCellLabel}>文本</Text>
                      <Text style={styles.statusCellValue}>{textConfigured ? textModel : '未配置'}</Text>
                      <Text style={styles.statusCellKey}>{maskedTextKey}</Text>
                    </View>
                  </View>
                </View>
              </View>
              <Text style={styles.connectedText}>{connected}</Text>
              <Pressable style={styles.testBtn} onPress={checkHealth}>
                <Text style={styles.testBtnText}>测试生图连接</Text>
              </Pressable>
            </View>

            {/* Image API config */}
            <View style={styles.glassCard}>
              <Pressable style={styles.settingsHeader} onPress={() => setExpandedImageSettings(v => !v)}>
                <View style={styles.flex}>
                  <Text style={styles.settingsHeaderTitle}>生图接口</Text>
                  <Text style={styles.settingsHeaderSub}>
                    {imageConfigured ? `${imageModel} · ${maskedImageKey}` : '文生图 / 以图改图，待配置'}
                  </Text>
                </View>
                <Ionicons name={expandedImageSettings ? 'chevron-up' : 'chevron-down'} size={20} color="#8e8e9a" />
              </Pressable>
              {expandedImageSettings && (<>
                <View style={styles.presetRow}>
                  <Pressable style={styles.presetBtn} onPress={() => setImageApiBase('https://api.sharehub.club')}>
                    <Text style={styles.presetBtnText}>ShareHub</Text>
                  </Pressable>
                  <Pressable style={styles.presetBtn} onPress={() => setImageApiBase('https://pucoding.com')}>
                    <Text style={styles.presetBtnText}>PuCoding</Text>
                  </Pressable>
                </View>
                <View style={styles.configField}>
                  <Text style={styles.configLabel}>Base</Text>
                  <TextInput style={styles.configInput} autoCapitalize="none" autoCorrect={false} value={imageApiBase} onChangeText={setImageApiBase} placeholder="https://api.sharehub.club" placeholderTextColor="#5e5e6a" />
                </View>
                <View style={styles.configField}>
                  <Text style={styles.configLabel}>Key</Text>
                  <TextInput style={styles.configInput} autoCapitalize="none" autoCorrect={false} secureTextEntry value={imageApiKey} onChangeText={setImageApiKey} placeholder="sk-image..." placeholderTextColor="#5e5e6a" />
                </View>
                <View style={styles.configField}>
                  <Text style={styles.configLabel}>Model</Text>
                  <TextInput style={styles.configInput} autoCapitalize="none" autoCorrect={false} value={imageModel} onChangeText={setImageModel} placeholder="gpt-image-2" placeholderTextColor="#5e5e6a" />
                </View>
              </>)}
            </View>

            {/* Text API config */}
            <View style={styles.glassCard}>
              <Pressable style={styles.settingsHeader} onPress={() => setExpandedTextSettings(v => !v)}>
                <View style={styles.flex}>
                  <Text style={styles.settingsHeaderTitle}>文本接口</Text>
                  <Text style={styles.settingsHeaderSub}>
                    {textConfigured ? `${textModel} · ${maskedTextKey}` : 'AI 提示词优化，待配置'}
                  </Text>
                </View>
                <Ionicons name={expandedTextSettings ? 'chevron-up' : 'chevron-down'} size={20} color="#8e8e9a" />
              </Pressable>
              {expandedTextSettings && (<>
                <View style={styles.presetRow}>
                  <Pressable style={styles.presetBtn} onPress={() => setTextApiBase('https://api.sharehub.club')}>
                    <Text style={styles.presetBtnText}>ShareHub</Text>
                  </Pressable>
                  <Pressable style={styles.presetBtn} onPress={() => setTextApiBase('https://pucoding.com')}>
                    <Text style={styles.presetBtnText}>PuCoding</Text>
                  </Pressable>
                </View>
                <View style={styles.configField}>
                  <Text style={styles.configLabel}>Base</Text>
                  <TextInput style={styles.configInput} autoCapitalize="none" autoCorrect={false} value={textApiBase} onChangeText={setTextApiBase} placeholder="https://api.sharehub.club" placeholderTextColor="#5e5e6a" />
                </View>
                <View style={styles.configField}>
                  <Text style={styles.configLabel}>Key</Text>
                  <TextInput style={styles.configInput} autoCapitalize="none" autoCorrect={false} secureTextEntry value={textApiKey} onChangeText={setTextApiKey} placeholder="sk-text..." placeholderTextColor="#5e5e6a" />
                </View>
                <View style={styles.configField}>
                  <Text style={styles.configLabel}>Model</Text>
                  <TextInput style={styles.configInput} autoCapitalize="none" autoCorrect={false} value={textModel} onChangeText={setTextModel} placeholder="gpt-4o-mini" placeholderTextColor="#5e5e6a" />
                </View>
              </>)}
            </View>
          </>)}

          <View style={styles.bottomSpacer} />
        </ScrollView>

        {/* ── Tab Bar ── */}
        <View style={styles.tabBar}>
          {([
            ['create', 'color-wand-outline', 'color-wand', '创作'],
            ['gallery', 'images-outline', 'images', '作品'],
            ['settings', 'settings-outline', 'settings', '设置'],
          ] as [Tab, string, string, string][]).map(([key, iconOut, iconFill, label]) => (
            <Pressable key={key} style={[styles.tabItem, tab === key && styles.tabItemActive]} onPress={() => setTab(key)}>
              <Ionicons name={(tab === key ? iconFill : iconOut) as any} size={22} color={tab === key ? '#f4b63f' : '#5e5e6a'} />
              <Text style={tab === key ? styles.tabTextActive : styles.tabText}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {/* ── Fullscreen Preview Modal ── */}
        <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}>
          <SafeAreaView style={styles.modalSafe}>
            {selected && (<>
              <Pressable style={styles.modalClose} onPress={() => setSelected(null)}>
                <Ionicons name="close" size={28} color="#f0f0f5" />
              </Pressable>
              <Image source={{ uri: selected.localUri || selected.url }} style={styles.modalImg} resizeMode="contain" />
              <View style={styles.modalPanel}>
                <Text style={styles.modalTitle}>作品详情</Text>
                <Text style={styles.modalPrompt} numberOfLines={4}>{selected.prompt || selected.revised_prompt || ''}</Text>
                <View style={styles.modalActions}>
                  <Pressable style={styles.modalAction} onPress={() => saveToAlbum(selected)}>
                    <Ionicons name="download-outline" size={18} color="#0a0a0f" />
                    <Text style={styles.modalActionText}>保存相册</Text>
                  </Pressable>
                  <Pressable style={styles.modalAction} onPress={() => copyPrompt(selected.prompt || selected.revised_prompt)}>
                    <Ionicons name="copy-outline" size={18} color="#0a0a0f" />
                    <Text style={styles.modalActionText}>复制提示词</Text>
                  </Pressable>
                  <Pressable style={styles.modalAction} onPress={() => editAgain(selected)}>
                    <Ionicons name="create-outline" size={18} color="#0a0a0f" />
                    <Text style={styles.modalActionText}>再次修改</Text>
                  </Pressable>
                </View>
              </View>
            </>)}
          </SafeAreaView>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const C = {
  bg: '#08080c',
  surface: '#0f0f16',
  surfaceHover: '#14141d',
  border: 'rgba(255,255,255,0.06)',
  borderFocus: 'rgba(244,182,63,0.25)',
  gold: '#f4b63f',
  goldMuted: '#d4a02a',
  text: '#f0f0f5',
  textSecondary: '#8e8e9a',
  textMuted: '#5e5e6a',
  danger: '#ff6b6b',
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 16 },
  bottomSpacer: { height: 24 },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20, marginTop: 8 },
  logo: {
    width: 46, height: 46, borderRadius: 14,
    backgroundColor: C.gold,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 26, fontWeight: '900', color: C.text, letterSpacing: 1 },
  sub: { color: C.textSecondary, fontSize: 13, marginTop: 1 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginLeft: 'auto' },
  statusDotOk: { backgroundColor: '#4ade80' },
  statusDotOff: { backgroundColor: '#3f3f4a' },

  // Glass card
  glassCard: {
    backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border,
    borderRadius: 20, padding: 16, marginBottom: 14,
  },

  // Mode row
  modeRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  modeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 44, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1, borderColor: C.border,
  },
  modeBtnActive: { backgroundColor: C.gold, borderColor: C.gold },
  modeBtnText: { color: C.textSecondary, fontSize: 15, fontWeight: '700' },
  modeBtnTextActive: { color: '#0a0a0f', fontSize: 15, fontWeight: '800' },

  // Prompt input
  promptInput: {
    minHeight: 140, maxHeight: 260,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 1, borderColor: C.border,
    borderRadius: 16, padding: 14,
    color: C.text, fontSize: 17, lineHeight: 26,
    textAlignVertical: 'top',
  },

  // Inline actions
  inlineActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  inlineAction: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 42, paddingHorizontal: 16,
    backgroundColor: C.gold, borderRadius: 13,
  },
  inlineActionText: { color: '#0a0a0f', fontSize: 14, fontWeight: '800' },
  inlineGhost: {
    height: 42, paddingHorizontal: 14,
    borderWidth: 1, borderColor: C.border,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 13, alignItems: 'center', justifyContent: 'center',
  },
  inlineGhostText: { color: C.textSecondary, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.45 },

  // Section title
  sectionTitle: { color: C.text, fontSize: 15, fontWeight: '800', marginBottom: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  // Chips
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: {
    borderWidth: 1, borderColor: C.border,
    backgroundColor: 'rgba(255,255,255,0.02)',
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
  },
  chipActive: { backgroundColor: C.gold, borderColor: C.gold },
  chipText: { color: C.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#0a0a0f', fontSize: 13, fontWeight: '800' },

  // Upload
  uploadZone: {
    borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: C.border, borderRadius: 16,
    minHeight: 72, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, paddingHorizontal: 12, marginTop: 4, marginBottom: 4,
  },
  uploadText: { color: C.text, fontSize: 15, fontWeight: '800', marginTop: 6 },
  uploadSub: { color: C.textMuted, fontSize: 12, marginTop: 2 },

  // Ref thumbs
  refRow: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  refThumb: { width: 64, height: 64, borderRadius: 12, borderWidth: 1, borderColor: C.border },

  // Progress
  progressWrap: { height: 32, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 999, overflow: 'hidden', marginTop: 14, justifyContent: 'center', borderWidth: 1, borderColor: C.border },
  progressBar: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.gold },
  progressText: { textAlign: 'center', fontWeight: '800', fontSize: 12, color: C.text },

  warnText: { marginTop: 12, color: C.danger, fontSize: 12, lineHeight: 18, fontWeight: '600' },

  // Generate CTA
  generateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 56, backgroundColor: C.gold, borderRadius: 18, marginTop: 12,
  },
  generateBtnText: { color: '#0a0a0f', fontSize: 17, fontWeight: '900' },
  generateBtnTextOff: { color: '#5e5e6a' },

  // Gallery
  galleryHint: { color: C.textMuted, fontSize: 12, marginTop: 2, marginBottom: 14 },
  emptyText: { color: C.textMuted, fontSize: 14, marginTop: 18, marginBottom: 18, textAlign: 'center', lineHeight: 22 },
  textBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  textBtnText: { color: C.textSecondary, fontSize: 12, fontWeight: '700' },

  resultGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  resultCard: {
    width: '47.5%', borderRadius: 16, overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 1, borderColor: C.border,
  },
  resultImg: { width: '100%', aspectRatio: 1 },
  resultMeta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 10, paddingVertical: 8,
  },
  resultMetaText: { color: C.textMuted, fontSize: 11, fontWeight: '600' },
  resultEditBtn: { padding: 4 },

  // Settings
  statusGrid: { flexDirection: 'row', gap: 10, marginTop: 8 },
  statusCell: {
    flex: 1, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: C.border,
  },
  statusLed: { width: 8, height: 8, borderRadius: 4, marginBottom: 6 },
  statusLedOk: { backgroundColor: '#4ade80' },
  statusLedOff: { backgroundColor: '#3f3f4a' },
  statusCellLabel: { color: C.textSecondary, fontSize: 11, fontWeight: '700', marginBottom: 2 },
  statusCellValue: { color: C.text, fontSize: 13, fontWeight: '800' },
  statusCellKey: { color: C.textMuted, fontSize: 10, marginTop: 2 },
  connectedText: { color: C.textSecondary, fontSize: 12, marginTop: 12, lineHeight: 18 },
  testBtn: {
    height: 40, backgroundColor: C.gold, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginTop: 12,
  },
  testBtnText: { color: '#0a0a0f', fontSize: 14, fontWeight: '800' },

  settingsHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  settingsHeaderTitle: { color: C.text, fontSize: 15, fontWeight: '800' },
  settingsHeaderSub: { color: C.textSecondary, fontSize: 12, marginTop: 2 },

  presetRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  presetBtn: {
    borderWidth: 1, borderColor: C.border,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7,
  },
  presetBtnText: { color: C.textSecondary, fontSize: 12, fontWeight: '700' },

  configField: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  configLabel: { width: 44, color: C.textSecondary, fontSize: 13, fontWeight: '700' },
  configInput: {
    flex: 1, minHeight: 42,
    borderWidth: 1, borderColor: C.border,
    borderRadius: 12, paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.02)',
    color: C.text, fontSize: 14,
  },

  // Tab bar
  tabBar: {
    flexDirection: 'row', gap: 0,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: Platform.OS === 'ios' ? 28 : 12,
    backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border,
  },
  tabItem: { flex: 1, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tabItemActive: { backgroundColor: 'rgba(244,182,63,0.1)' },
  tabText: { color: C.textMuted, fontSize: 11, fontWeight: '700' },
  tabTextActive: { color: C.gold, fontSize: 11, fontWeight: '800' },

  // Modal
  modalSafe: { flex: 1, backgroundColor: '#050508' },
  modalClose: { position: 'absolute', top: Platform.OS === 'ios' ? 56 : 16, right: 16, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  modalImg: { flex: 1, width: '100%' },
  modalPanel: {
    backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, borderTopWidth: 1, borderColor: C.border,
  },
  modalTitle: { color: C.text, fontSize: 17, fontWeight: '900', marginBottom: 8 },
  modalPrompt: { color: C.textSecondary, lineHeight: 20 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  modalAction: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 44, backgroundColor: C.gold, borderRadius: 13,
  },
  modalActionText: { color: '#0a0a0f', fontSize: 13, fontWeight: '800' },
});
