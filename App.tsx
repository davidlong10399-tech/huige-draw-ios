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
  // backward compatibility with v3
  apiBase?: string;
  apiKey?: string;
  assistantModel?: string;
};

const CONFIG_KEY = 'huige-draw-direct-config-v4';
const LEGACY_CONFIG_KEY = 'huige-draw-direct-config-v3';
const HISTORY_KEY = 'huige-draw-history-v3';
const MAX_HISTORY = 50;
const APP_VERSION = 'v0.2.8';
const APP_BUILD_LABEL = 'iOS下载权限修复版';
const APP_BUILD_NUMBER = '20260526.8';
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

async function makeUploadableRef(asset: { uri: string; fileName?: string | null; mimeType?: string | null }, index = 0): Promise<RefImage> {
  const converted = await ImageManipulator.manipulateAsync(asset.uri, [], { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG });
  const baseName = asset.fileName?.replace(/\.[^.]+$/, '') || `ref-${Date.now()}-${index}`;
  return { name: `${baseName}.jpg`, uri: converted.uri, mimeType: 'image/jpeg' };
}

async function materializeImageToJpeg(item: GenerateResult) {
  const workDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!workDir) throw new Error('本地缓存目录不可用');

  let sourceUri = item.localUri || item.url;
  if (!sourceUri) throw new Error('图片地址为空');

  // iOS 上 NSURLSession 下载文件移动到 Documents 子目录可能触发 NSCocoaErrorDomain 513。
  // 所以这里不再创建 Documents/huaren 子目录，所有中间文件都放 cacheDirectory 根目录。
  if (sourceUri.startsWith('data:image/')) {
    const base64 = sourceUri.split(',')[1] || '';
    if (!base64) throw new Error('图片数据为空');
    const tmpUri = `${workDir}huaren-inline-${item.id || makeId()}-${Date.now()}.png`;
    await FileSystem.writeAsStringAsync(tmpUri, base64, { encoding: FileSystem.EncodingType.Base64 });
    sourceUri = tmpUri;
  } else if (/^https?:/i.test(sourceUri)) {
    const tmpUri = `${workDir}huaren-download-${item.id || makeId()}-${Date.now()}.png`;
    const downloaded = await FileSystem.downloadAsync(sourceUri, tmpUri);
    if (downloaded.status && downloaded.status >= 400) throw new Error(`图片下载失败 HTTP ${downloaded.status}`);
    sourceUri = downloaded.uri || tmpUri;
  }

  if (!sourceUri.startsWith('file:')) throw new Error('无法将图片转成本地文件');
  const info = await FileSystem.getInfoAsync(sourceUri);
  if (!info.exists) throw new Error('图片本地文件不存在');

  const normalized = await ImageManipulator.manipulateAsync(
    sourceUri,
    [],
    { compress: 0.96, format: ImageManipulator.SaveFormat.JPEG }
  );
  return normalized.uri;
}

async function persistImage(result: GenerateResult) {
  const localUri = await materializeImageToJpeg(result);
  return { ...result, localUri };
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

  async function finishProgress(label: string) {
    if (progressTimer.current) clearInterval(progressTimer.current);
    setProgressText(label);
    setProgress(1);
    await sleep(450);
    setProgress(0);
    setProgressText('');
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
      setConnected(`生图连接失败：${e.message}`);
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
      setProgress(0);
      Alert.alert('优化失败', e.message || String(e));
    } finally {
      setOptimizing(false);
    }
  }

  async function runGenerate() {
    if (!imageApiKey.trim()) return Alert.alert('缺少生图 API Key', '请先在设置里填写生图 API Key。');
    if (!fullPrompt.trim()) return Alert.alert('先输入提示词');
    if (mode === 'edit' && !refs.length) return Alert.alert('缺少参考图', '以图改图必须先上传参考图。请先点“上传参考图”，或切回“文生图”。');
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
      setProgress(0);
      Alert.alert('生成失败', e.message || String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function saveToAlbum(item: GenerateResult) {
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) return Alert.alert('需要相册权限', '请允许保存图片到相册。');
      const uri = await materializeImageToJpeg(item);
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
    Alert.alert('清空历史？', '会清空 App 内作品流记录，不删除系统相册。', [
      { text: '取消' },
      { text: '清空', style: 'destructive', onPress: () => setResults([]) },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <View style={styles.logo}><Text style={styles.logoText}>刃</Text></View>
            <View style={styles.flex}>
              <View style={styles.headerTopRow}>
                <Text style={styles.title}>画刃</Text>
                <View style={styles.badge}><Text style={styles.badgeText}>{tab === 'create' ? '创作' : tab === 'gallery' ? '作品' : '设置'}</Text></View>
              </View>
              <Text style={styles.sub}>{hydrated ? connected : '正在恢复本地配置与作品流...'}</Text>
            </View>
          </View>

          {tab === 'create' && <>
            <View style={styles.hero}>
              <View style={styles.rowBetween}>
                <View style={styles.flex}>
                  <Text style={styles.heroEyebrow}>AI Studio 工作台</Text>
                  <Text style={styles.heroTitle}>输入提示词，选参考图，直接出图。</Text>
                </View>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{mode === 'generate' ? '文生图' : '以图改图'}</Text>
                </View>
              </View>
              <View style={styles.statsRow}>
                <View style={styles.statPill}><Text style={styles.statLabel}>参考图</Text><Text style={styles.statValue}>{refs.length}/4</Text></View>
                <View style={styles.statPill}><Text style={styles.statLabel}>作品</Text><Text style={styles.statValue}>{results.length}</Text></View>
                <View style={styles.statPill}><Text style={styles.statLabel}>状态</Text><Text style={styles.statValue}>{activeTask ? '常亮中' : '待命'}</Text></View>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>创作面板</Text>
              <View style={styles.segment}>
                {(['generate', 'edit'] as Mode[]).map(m => (
                  <Pressable key={m} style={[styles.segmentItem, mode === m && styles.segmentActive]} onPress={() => setMode(m)}>
                    <Text style={mode === m ? styles.segmentTextActive : styles.segmentText}>{m === 'generate' ? '文生图' : '以图改图'}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput style={styles.inputCompact} multiline placeholder="输入你想生成的画面" placeholderTextColor="#927c66" value={prompt} onChangeText={setPrompt} />
              <View style={styles.inlineActionRow}>
                <Pressable style={[styles.inlineAction, optimizing && styles.disabled]} onPress={runOptimize} disabled={optimizing || !hydrated}>
                  <Text style={styles.inlineActionText}>{optimizing ? '优化中...' : '优化'}</Text>
                </Pressable>
                <Pressable style={styles.inlineGhost} onPress={() => setPrompt('')} disabled={optimizing || generating}>
                  <Text style={styles.inlineGhostText}>清空</Text>
                </Pressable>
              </View>
              <Text style={styles.label}>比例</Text>
              <View style={styles.chips}>
                {['1:1', '9:16', '16:9'].map(s => (
                  <Pressable key={s} style={[styles.chip, size === s && styles.chipActive]} onPress={() => setSize(s)}>
                    <Text style={size === s ? styles.chipActiveText : styles.chipText}>{s}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.label}>风格</Text>
              <View style={styles.chips}>
                {stylesList.map(s => (
                  <Pressable key={s} style={[styles.chip, style === s && styles.chipActive]} onPress={() => setStyle(s)}>
                    <Text style={style === s ? styles.chipActiveText : styles.chipText}>{s}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable style={styles.upload} onPress={pickImages}>
                <Text style={styles.uploadText}>{refs.length ? `已选 ${refs.length} 张参考图` : '上传参考图'}</Text>
                <Text style={styles.uploadSub}>{refs.length ? '点缩略图可移除单张参考图' : '最多 4 张，用于以图改图'}</Text>
              </Pressable>
              {!!refs.length && <View style={styles.refRow}>{refs.map((r, i) => <Pressable key={i} onPress={() => setRefs(refs.filter((_, idx) => idx !== i))}><Image source={{ uri: r.uri }} style={styles.refImg} /></Pressable>)}</View>}
              {!!progress && <View style={styles.progressWrap}><View style={[styles.progressBar, { width: `${Math.round(progress * 100)}%` }]} /><Text style={styles.progressText}>{progressText} · {Math.round(progress * 100)}% · 保持屏幕常亮</Text></View>}
              {editBlocked && <Text style={styles.warnText}>以图改图需要先上传参考图；没有参考图时不会请求接口。</Text>}
              <Pressable style={[styles.generate, generateDisabled && styles.disabled]} onPress={runGenerate} disabled={generateDisabled}>
                <Text style={styles.generateText}>{!hydrated ? '正在恢复数据...' : generating ? '生成中...' : editBlocked ? '请先上传参考图' : '开始生成'}</Text>
              </Pressable>
            </View>
          </>}

          {tab === 'gallery' && <View style={styles.card}>
            <View style={styles.rowBetween}>
              <View>
                <Text style={styles.cardTitle}>作品流</Text>
                <Text style={styles.sub}>点开看大图，保存相册，复制提示词，或者再次修改</Text>
              </View>
              {!!results.length && <Pressable style={styles.smallButton} onPress={clearHistory}><Text style={styles.smallButtonText}>清空</Text></Pressable>}
            </View>
            {!results.length && <Text style={styles.emptyText}>{hydrated ? '暂无作品，先去创作一张。' : '正在恢复作品流...'}</Text>}
            <View style={styles.resultGrid}>
              {results.map((r, i) => (
                <Pressable key={r.id || `${r.url}-${i}`} style={styles.resultCard} onPress={() => setSelected(r)}>
                  <Image source={{ uri: r.localUri || r.url }} style={styles.resultImg} />
                  <View style={styles.resultActions}>
                    <Text style={styles.sub}>{r.elapsed ? `${r.elapsed}s` : ''}</Text>
                    <Pressable style={styles.smallButton} onPress={() => editAgain(r)}><Text style={styles.smallButtonText}>再次修改</Text></Pressable>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>}

          {tab === 'settings' && <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>版本信息</Text>
              <Text style={styles.sub}>{APP_VERSION} · {APP_BUILD_LABEL}</Text>
              <Text style={styles.sub}>Build {APP_BUILD_NUMBER}</Text>
            </View>
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <View>
                  <Text style={styles.cardTitle}>生图供应商</Text>
                  <Text style={styles.sub}>用于文生图和以图改图 · Key：{maskedImageKey}</Text>
                </View>
                <Pressable style={styles.smallButton} onPress={checkHealth}><Text style={styles.smallButtonText}>测试</Text></Pressable>
              </View>
              <View style={styles.presetRow}>
                <Pressable style={styles.presetButton} onPress={() => setImageApiBase('https://api.sharehub.club')}><Text style={styles.presetText}>ShareHub</Text></Pressable>
                <Pressable style={styles.presetButton} onPress={() => setImageApiBase('https://pucoding.com')}><Text style={styles.presetText}>PuCoding</Text></Pressable>
              </View>
              <Text style={styles.label}>API Base URL</Text>
              <TextInput style={styles.singleInput} autoCapitalize="none" autoCorrect={false} value={imageApiBase} onChangeText={setImageApiBase} placeholder="https://api.sharehub.club" placeholderTextColor="#927c66" />
              <Text style={styles.label}>API Key</Text>
              <TextInput style={styles.singleInput} autoCapitalize="none" autoCorrect={false} secureTextEntry value={imageApiKey} onChangeText={setImageApiKey} placeholder="sk-image..." placeholderTextColor="#927c66" />
              <Text style={styles.label}>生图模型</Text>
              <TextInput style={styles.singleInput} autoCapitalize="none" autoCorrect={false} value={imageModel} onChangeText={setImageModel} placeholder="gpt-image-2" placeholderTextColor="#927c66" />
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>提示词优化供应商</Text>
              <Text style={styles.sub}>用于 AI 优化提示词 · Key：{maskedTextKey}</Text>
              <View style={styles.presetRow}>
                <Pressable style={styles.presetButton} onPress={() => setTextApiBase('https://api.sharehub.club')}><Text style={styles.presetText}>ShareHub</Text></Pressable>
                <Pressable style={styles.presetButton} onPress={() => setTextApiBase('https://pucoding.com')}><Text style={styles.presetText}>PuCoding</Text></Pressable>
              </View>
              <Text style={styles.label}>API Base URL</Text>
              <TextInput style={styles.singleInput} autoCapitalize="none" autoCorrect={false} value={textApiBase} onChangeText={setTextApiBase} placeholder="https://api.sharehub.club" placeholderTextColor="#927c66" />
              <Text style={styles.label}>API Key</Text>
              <TextInput style={styles.singleInput} autoCapitalize="none" autoCorrect={false} secureTextEntry value={textApiKey} onChangeText={setTextApiKey} placeholder="sk-text..." placeholderTextColor="#927c66" />
              <Text style={styles.label}>文本模型</Text>
              <TextInput style={styles.singleInput} autoCapitalize="none" autoCorrect={false} value={textModel} onChangeText={setTextModel} placeholder="claude-sonnet-4-6" placeholderTextColor="#927c66" />
            </View>
          </>}
        </ScrollView>

        <View style={styles.tabBar}>
          {([
            ['create', '创作'],
            ['gallery', '作品'],
            ['settings', '设置'],
          ] as [Tab, string][]).map(([key, label]) => (
            <Pressable key={key} style={[styles.tabItem, tab === key && styles.tabItemActive]} onPress={() => setTab(key)}>
              <Text style={tab === key ? styles.tabTextActive : styles.tabText}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}>
          <SafeAreaView style={styles.modalSafe}>
            {selected && <>
              <Image source={{ uri: selected.localUri || selected.url }} style={styles.modalImg} resizeMode="contain" />
              <View style={styles.modalPanel}>
                <Text style={styles.cardTitle}>作品详情</Text>
                <Text style={styles.modalPrompt} numberOfLines={4}>{selected.prompt || selected.revised_prompt || ''}</Text>
                <View style={styles.modalActions}>
                  <Pressable style={styles.testButtonFlex} onPress={() => saveToAlbum(selected)}><Text style={styles.testButtonText}>保存相册</Text></Pressable>
                  <Pressable style={styles.testButtonFlex} onPress={() => copyPrompt(selected.prompt || selected.revised_prompt)}><Text style={styles.testButtonText}>复制提示词</Text></Pressable>
                  <Pressable style={styles.testButtonFlex} onPress={() => editAgain(selected)}><Text style={styles.testButtonText}>再次修改</Text></Pressable>
                </View>
                <Pressable style={styles.closeButton} onPress={() => setSelected(null)}><Text style={styles.closeText}>关闭</Text></Pressable>
              </View>
            </>}
          </SafeAreaView>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0d0f14' },
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 42 },
  header: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 14 },
  logo: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#f4b63f', alignItems: 'center', justifyContent: 'center' },
  logoText: { color: '#10131a', fontWeight: '900', fontSize: 24 },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerAction: { borderWidth: 1, borderColor: '#2a313d', backgroundColor: '#11151c', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  headerActionText: { color: '#d4deef', fontSize: 12, fontWeight: '800' },
  title: { fontSize: 24, fontWeight: '900', color: '#f5f7fb' },
  sub: { color: '#8a94a6', fontSize: 12, marginTop: 3 },
  hero: { backgroundColor: '#121721', borderWidth: 1, borderColor: '#222a36', borderRadius: 24, padding: 16, marginBottom: 14 },
  heroEyebrow: { color: '#f4b63f', fontSize: 12, fontWeight: '900', letterSpacing: 0 },
  heroTitle: { color: '#f5f7fb', fontSize: 18, fontWeight: '900', lineHeight: 24, marginTop: 8 },
  badge: { alignSelf: 'flex-start', backgroundColor: '#f4b63f', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  badgeText: { color: '#10131a', fontSize: 12, fontWeight: '900' },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  statPill: { flexGrow: 1, minWidth: 92, borderRadius: 16, borderWidth: 1, borderColor: '#243043', backgroundColor: '#0f141c', paddingHorizontal: 12, paddingVertical: 10 },
  statLabel: { color: '#8a94a6', fontSize: 11 },
  statValue: { color: '#f5f7fb', fontSize: 15, fontWeight: '900', marginTop: 4 },
  card: { backgroundColor: '#121721', borderWidth: 1, borderColor: '#222a36', borderRadius: 24, padding: 16, marginBottom: 14, shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  cardTitle: { fontSize: 17, fontWeight: '900', color: '#f5f7fb' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: { borderWidth: 1, borderColor: '#2a313d', backgroundColor: '#0f141c', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999 },
  chipActive: { backgroundColor: '#f4b63f', borderColor: '#f4b63f' },
  chipText: { color: '#c2cad6', fontSize: 12 },
  chipActiveText: { color: '#10131a', fontSize: 12, fontWeight: '900' },
  smallButton: { backgroundColor: '#0f141c', borderWidth: 1, borderColor: '#2a313d', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 },
  segment: { flexDirection: 'row', backgroundColor: '#0f141c', borderRadius: 16, padding: 4, marginTop: 14, borderWidth: 1, borderColor: '#243043' },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 13 },
  segmentActive: { backgroundColor: '#f4b63f' },
  segmentText: { color: '#9aa5b6' },
  segmentTextActive: { color: '#10131a', fontWeight: '900' },
  input: { minHeight: 150, borderWidth: 1, borderColor: '#2a313d', borderRadius: 18, padding: 12, backgroundColor: '#0f141c', marginTop: 14, textAlignVertical: 'top', lineHeight: 22, color: '#f5f7fb', fontSize: 16 },
  singleInput: { height: 46, borderWidth: 1, borderColor: '#2a313d', borderRadius: 14, paddingHorizontal: 12, backgroundColor: '#0f141c', marginTop: 8, color: '#f5f7fb', fontSize: 16 },
  label: { marginTop: 14, fontWeight: '800', color: '#c2cad6' },
  testButton: { height: 46, backgroundColor: '#f4b63f', borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  testButtonFlex: { flex: 1, height: 48, backgroundColor: '#f4b63f', borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  testButtonText: { color: '#10131a', fontWeight: '900' },
  inlineActionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  inlineAction: { height: 44, paddingHorizontal: 14, backgroundColor: '#f4b63f', borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  inlineActionText: { color: '#10131a', fontWeight: '900' },
  inlineHint: { flex: 1, borderRadius: 14, borderWidth: 1, borderColor: '#243043', backgroundColor: '#0f141c', paddingHorizontal: 12, paddingVertical: 10 },
  inlineHintText: { color: '#8a94a6', fontSize: 12, lineHeight: 16 },
  upload: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#354154', backgroundColor: '#0f141c', borderRadius: 18, minHeight: 84, alignItems: 'center', justifyContent: 'center', marginTop: 14, paddingHorizontal: 12 },
  uploadText: { color: '#f5f7fb', fontWeight: '900' },
  uploadSub: { color: '#8a94a6', fontSize: 12, marginTop: 4, textAlign: 'center', lineHeight: 16 },
  refRow: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  refImg: { width: 70, height: 70, borderRadius: 14 },
  progressWrap: { height: 30, backgroundColor: '#0f141c', borderRadius: 999, overflow: 'hidden', marginTop: 14, justifyContent: 'center', borderWidth: 1, borderColor: '#243043' },
  progressBar: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#f4b63f' },
  progressText: { textAlign: 'center', fontWeight: '900', fontSize: 12, color: '#f5f7fb' },
  generate: { height: 56, backgroundColor: '#ff7a1a', borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  disabled: { opacity: 0.58 },
  generateText: { color: 'white', fontSize: 16, fontWeight: '900' },
  resultGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  resultCard: { width: '48%', borderRadius: 20, overflow: 'hidden', backgroundColor: '#0f141c', borderWidth: 1, borderColor: '#243043' },
  resultImg: { width: '100%', aspectRatio: 1 },
  resultActions: { padding: 10, gap: 8 },
  modalSafe: { flex: 1, backgroundColor: '#090b0f' },
  modalImg: { flex: 1, width: '100%' },
  modalPanel: { backgroundColor: '#121721', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, borderTopWidth: 1, borderColor: '#222a36' },
  modalPrompt: { color: '#c2cad6', lineHeight: 20, marginTop: 8 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  closeButton: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  warnText: { marginTop: 12, color: '#ff8a8a', fontSize: 12, lineHeight: 18, fontWeight: '700' },
  closeText: { fontWeight: '900', color: '#d4deef' },
  inputCompact: { minHeight: 118, borderWidth: 1, borderColor: '#2a313d', borderRadius: 18, padding: 12, backgroundColor: '#0f141c', marginTop: 14, textAlignVertical: 'top', lineHeight: 22, color: '#f5f7fb', fontSize: 16 },
  inlineGhost: { height: 44, paddingHorizontal: 14, borderWidth: 1, borderColor: '#2a313d', backgroundColor: '#0f141c', borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  inlineGhostText: { color: '#d4deef', fontWeight: '900' },
  presetRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  presetButton: { borderWidth: 1, borderColor: '#2a313d', backgroundColor: '#0f141c', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  presetText: { color: '#d4deef', fontSize: 12, fontWeight: '900' },
  smallButtonText: { color: '#d4deef', fontSize: 12, fontWeight: '900' },
  emptyText: { color: '#8a94a6', fontSize: 13, marginTop: 18, lineHeight: 20 },
  tabBar: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 10, paddingBottom: Platform.OS === 'ios' ? 18 : 12, backgroundColor: '#0d0f14', borderTopWidth: 1, borderTopColor: '#222a36' },
  tabItem: { flex: 1, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f141c', borderWidth: 1, borderColor: '#243043' },
  tabItemActive: { backgroundColor: '#f4b63f', borderColor: '#f4b63f' },
  tabText: { color: '#9aa5b6', fontWeight: '900' },
  tabTextActive: { color: '#10131a', fontWeight: '900' },
});

