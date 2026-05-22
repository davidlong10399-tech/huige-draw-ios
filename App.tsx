import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { editImage, generateImage, health, DEFAULT_API_BASE, DEFAULT_ASSISTANT_MODEL, DEFAULT_IMAGE_MODEL, DirectApiConfig, GenerateResult, optimizePrompt, RefImage } from './src/lib/api';

type Mode = 'generate' | 'edit';
type SavedConfig = DirectApiConfig & { showSettings?: boolean };

const CONFIG_KEY = 'huige-draw-direct-config-v3';
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

async function makeUploadableRef(asset: { uri: string; fileName?: string | null; mimeType?: string | null }, index = 0): Promise<RefImage> {
  const converted = await ImageManipulator.manipulateAsync(asset.uri, [], { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG });
  const baseName = asset.fileName?.replace(/\.[^.]+$/, '') || `ref-${Date.now()}-${index}`;
  return { name: `${baseName}.jpg`, uri: converted.uri, mimeType: 'image/jpeg' };
}

async function persistImage(result: GenerateResult) {
  if (!FileSystem.documentDirectory) return result;
  const dir = `${FileSystem.documentDirectory}huaren/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const filename = `${result.id || makeId()}.png`;
  const localUri = `${dir}${filename}`;
  if (result.url.startsWith('data:image/')) {
    const base64 = result.url.split(',')[1] || '';
    await FileSystem.writeAsStringAsync(localUri, base64, { encoding: FileSystem.EncodingType.Base64 });
  } else if (/^https?:/i.test(result.url)) {
    await FileSystem.downloadAsync(result.url, localUri);
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
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [apiKey, setApiKey] = useState('');
  const [imageModel, setImageModel] = useState(DEFAULT_IMAGE_MODEL);
  const [assistantModel, setAssistantModel] = useState(DEFAULT_ASSISTANT_MODEL);
  const [showSettings, setShowSettings] = useState(true);
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

  const config: DirectApiConfig = useMemo(() => ({ apiBase, apiKey, imageModel, assistantModel }), [apiBase, apiKey, imageModel, assistantModel]);
  const fullPrompt = useMemo(() => [prompt.trim(), stylePrompts[style] || ''].filter(Boolean).join('，'), [prompt, style]);
  const maskedKey = apiKey ? `${apiKey.slice(0, 6)}****${apiKey.slice(-4)}` : '未填写';
  const editBlocked = mode === 'edit' && refs.length === 0;
  const generateDisabled = generating || optimizing || editBlocked || !hydrated;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(CONFIG_KEY);
        if (saved && alive) {
          const c = JSON.parse(saved) as SavedConfig;
          setApiBase(c.apiBase || DEFAULT_API_BASE);
          setApiKey(typeof c.apiKey === 'string' ? c.apiKey : '');
          setImageModel(c.imageModel || DEFAULT_IMAGE_MODEL);
          setAssistantModel(c.assistantModel || DEFAULT_ASSISTANT_MODEL);
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
    AsyncStorage.setItem(CONFIG_KEY, JSON.stringify({ apiBase, apiKey, imageModel, assistantModel, showSettings })).catch(() => {});
  }, [hydrated, apiBase, apiKey, imageModel, assistantModel, showSettings]);

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
    if (!apiKey.trim()) {
      setConnected('请先填写 API Key');
      return;
    }
    setConnected('测试连接中...');
    try {
      const h = await health(config);
      setConnected(`直连正常 · ${h.imageModel || imageModel}`);
    } catch (e: any) {
      setConnected(`连接失败：${e.message}`);
    }
  }, [apiKey, config, imageModel]);

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
    if (!apiKey.trim()) return Alert.alert('缺少 API Key', '请先在设置里填写 API Key。');
    if (!prompt.trim()) return Alert.alert('先输入提示词');
    setOptimizing(true);
    startProgress('正在优化提示词');
    try {
      const r = await optimizePrompt(config, prompt);
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
    if (!apiKey.trim()) return Alert.alert('缺少 API Key', '请先在设置里填写 API Key。');
    if (!fullPrompt.trim()) return Alert.alert('先输入提示词');
    if (mode === 'edit' && !refs.length) return Alert.alert('缺少参考图', '以图改图必须先上传参考图。请先点“上传参考图”，或切回“文生图”。');
    setGenerating(true);
    startProgress(mode === 'edit' ? '正在以图改图' : '正在生成图片');
    try {
      const started = Date.now();
      const raw = mode === 'edit'
        ? await editImage(config, { prompt: fullPrompt, size, images: refs })
        : await generateImage(config, { prompt: fullPrompt, size });
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
      setPrompt('在这张图基础上，');
      setSelected(null);
    } catch (e: any) {
      Alert.alert('再次修改失败', e.message || String(e));
    }
  }

  function clearHistory() {
    Alert.alert('清空历史？', '会清空 App 内作品流记录，不删除系统相册。', [
      { text: '取消' },
      { text: '清空', style: 'destructive', onPress: () => setResults([]) },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <View style={styles.logo}><Text style={styles.logoText}>刃</Text></View>
            <View style={styles.flex}>
              <Text style={styles.title}>画刃</Text>
              <Text style={styles.sub}>{hydrated ? connected : '正在恢复本地配置与作品流...'}</Text>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <View>
                <Text style={styles.cardTitle}>直连接口设置</Text>
                <Text style={styles.sub}>配置会自动保存 · Key：{maskedKey}</Text>
              </View>
              <Pressable style={styles.smallButton} onPress={() => setShowSettings(v => !v)}>
                <Text>{showSettings ? '收起' : '展开'}</Text>
              </Pressable>
            </View>
            {showSettings && <>
              <Text style={styles.label}>API Base URL</Text>
              <TextInput style={styles.singleInput} autoCapitalize="none" autoCorrect={false} value={apiBase} onChangeText={setApiBase} placeholder="https://pucoding.com" />
              <Text style={styles.label}>API Key</Text>
              <TextInput style={styles.singleInput} autoCapitalize="none" autoCorrect={false} secureTextEntry value={apiKey} onChangeText={setApiKey} placeholder="sk-..." />
              <Text style={styles.label}>生图模型</Text>
              <TextInput style={styles.singleInput} autoCapitalize="none" autoCorrect={false} value={imageModel} onChangeText={setImageModel} />
              <Text style={styles.label}>助手模型</Text>
              <TextInput style={styles.singleInput} autoCapitalize="none" autoCorrect={false} value={assistantModel} onChangeText={setAssistantModel} />
              <Pressable style={styles.testButton} onPress={checkHealth}><Text style={styles.testButtonText}>测试连接</Text></Pressable>
            </>}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>创作参数</Text>
            <View style={styles.segment}>
              {(['generate', 'edit'] as Mode[]).map(m => (
                <Pressable key={m} style={[styles.segmentItem, mode === m && styles.segmentActive]} onPress={() => setMode(m)}>
                  <Text style={mode === m ? styles.segmentTextActive : styles.segmentText}>{m === 'generate' ? '文生图' : '以图改图'}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput style={styles.input} multiline placeholder="输入你想生成的画面" value={prompt} onChangeText={setPrompt} />
            <Pressable style={[styles.testButton, optimizing && styles.disabled]} onPress={runOptimize} disabled={optimizing || !hydrated}>
              <Text style={styles.testButtonText}>{optimizing ? '优化中...' : 'AI 优化提示词'}</Text>
            </Pressable>
            <Text style={styles.label}>风格</Text>
            <View style={styles.chips}>
              {stylesList.map(s => (
                <Pressable key={s} style={[styles.chip, style === s && styles.chipActive]} onPress={() => setStyle(s)}>
                  <Text style={style === s ? styles.chipActiveText : styles.chipText}>{s}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>比例</Text>
            <View style={styles.chips}>
              {['1:1', '16:9', '9:16'].map(s => (
                <Pressable key={s} style={[styles.chip, size === s && styles.chipActive]} onPress={() => setSize(s)}>
                  <Text style={size === s ? styles.chipActiveText : styles.chipText}>{s}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={styles.upload} onPress={pickImages}><Text style={styles.uploadText}>{refs.length ? `已选 ${refs.length} 张参考图` : '上传参考图'}</Text></Pressable>
            {!!refs.length && <View style={styles.refRow}>{refs.map((r, i) => <Pressable key={i} onPress={() => setRefs(refs.filter((_, idx) => idx !== i))}><Image source={{ uri: r.uri }} style={styles.refImg} /></Pressable>)}</View>}
            {!!progress && <View style={styles.progressWrap}><View style={[styles.progressBar, { width: `${Math.round(progress * 100)}%` }]} /><Text style={styles.progressText}>{progressText} · {Math.round(progress * 100)}%</Text></View>}
            {editBlocked && <Text style={styles.warnText}>以图改图需要先上传参考图；没有参考图时不会请求接口，避免上游报错和浪费额度。</Text>}
            <Pressable style={[styles.generate, generateDisabled && styles.disabled]} onPress={runGenerate} disabled={generateDisabled}>
              <Text style={styles.generateText}>{!hydrated ? '正在恢复数据...' : generating ? '生成中...' : editBlocked ? '请先上传参考图' : '开始生成'}</Text>
            </Pressable>
          </View>

          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <View>
                <Text style={styles.cardTitle}>作品流</Text>
                <Text style={styles.sub}>点击图片可放大、保存、再次修改</Text>
              </View>
              {!!results.length && <Pressable style={styles.smallButton} onPress={clearHistory}><Text>清空</Text></Pressable>}
            </View>
            {!results.length && <Text style={styles.sub}>{hydrated ? '暂无作品' : '正在恢复作品流...'}</Text>}
            {results.map((r, i) => (
              <Pressable key={r.id || `${r.url}-${i}`} style={styles.resultCard} onPress={() => setSelected(r)}>
                <Image source={{ uri: r.localUri || r.url }} style={styles.resultImg} />
                <View style={styles.resultActions}>
                  <Text style={styles.sub}>{r.elapsed ? `${r.elapsed}s` : ''}</Text>
                  <Pressable style={styles.smallButton} onPress={() => editAgain(r)}><Text>再次修改</Text></Pressable>
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}>
          <SafeAreaView style={styles.modalSafe}>
            {selected && <>
              <Image source={{ uri: selected.localUri || selected.url }} style={styles.modalImg} resizeMode="contain" />
              <View style={styles.modalPanel}>
                <Text style={styles.cardTitle}>作品详情</Text>
                <Text style={styles.modalPrompt} numberOfLines={4}>{selected.prompt || selected.revised_prompt || ''}</Text>
                <View style={styles.modalActions}>
                  <Pressable style={styles.testButtonFlex} onPress={() => saveToAlbum(selected)}><Text style={styles.testButtonText}>保存相册</Text></Pressable>
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
  safe: { flex: 1, backgroundColor: '#f5efe6' },
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 42 },
  header: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 14 },
  logo: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#15110d', alignItems: 'center', justifyContent: 'center' },
  logoText: { color: '#f3cb62', fontWeight: '900', fontSize: 24 },
  title: { fontSize: 24, fontWeight: '900', color: '#201915' },
  sub: { color: '#8c7a66', fontSize: 12, marginTop: 3 },
  card: { backgroundColor: '#fffaf2', borderWidth: 1, borderColor: '#eadcc9', borderRadius: 24, padding: 16, marginBottom: 14, shadowColor: '#563718', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  cardTitle: { fontSize: 17, fontWeight: '900', color: '#201915' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: { borderWidth: 1, borderColor: '#eadcc9', backgroundColor: '#fff7ea', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999 },
  chipActive: { backgroundColor: '#15110d', borderColor: '#15110d' },
  chipText: { color: '#725d46', fontSize: 12 },
  chipActiveText: { color: 'white', fontSize: 12 },
  smallButton: { backgroundColor: '#fff7ea', borderWidth: 1, borderColor: '#eadcc9', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 },
  segment: { flexDirection: 'row', backgroundColor: '#f5eadc', borderRadius: 16, padding: 4, marginTop: 14 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 13 },
  segmentActive: { backgroundColor: '#15110d' },
  segmentText: { color: '#725d46' },
  segmentTextActive: { color: 'white', fontWeight: '800' },
  input: { minHeight: 130, borderWidth: 1, borderColor: '#eadcc9', borderRadius: 18, padding: 12, backgroundColor: '#fffdf8', marginTop: 14, textAlignVertical: 'top', lineHeight: 22 },
  singleInput: { height: 46, borderWidth: 1, borderColor: '#eadcc9', borderRadius: 14, paddingHorizontal: 12, backgroundColor: '#fffdf8', marginTop: 8 },
  label: { marginTop: 14, fontWeight: '800', color: '#6d5b47' },
  testButton: { height: 46, backgroundColor: '#15110d', borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  testButtonFlex: { flex: 1, height: 48, backgroundColor: '#15110d', borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  testButtonText: { color: 'white', fontWeight: '900' },
  upload: { borderWidth: 2, borderStyle: 'dashed', borderColor: '#d8c7b2', backgroundColor: '#fffdf8', borderRadius: 18, minHeight: 78, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  uploadText: { color: '#725d46', fontWeight: '800' },
  refRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  refImg: { width: 70, height: 70, borderRadius: 14 },
  progressWrap: { height: 30, backgroundColor: '#f2e4d3', borderRadius: 999, overflow: 'hidden', marginTop: 14, justifyContent: 'center' },
  progressBar: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#e56f26' },
  progressText: { textAlign: 'center', fontWeight: '900', fontSize: 12, color: '#201915' },
  generate: { height: 54, backgroundColor: '#e56f26', borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  disabled: { opacity: 0.6 },
  generateText: { color: 'white', fontSize: 16, fontWeight: '900' },
  resultCard: { marginTop: 12, borderRadius: 22, overflow: 'hidden', backgroundColor: 'white', borderWidth: 1, borderColor: '#eadcc9' },
  resultImg: { width: '100%', aspectRatio: 1 },
  resultActions: { padding: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalSafe: { flex: 1, backgroundColor: '#111' },
  modalImg: { flex: 1, width: '100%' },
  modalPanel: { backgroundColor: '#fffaf2', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16 },
  modalPrompt: { color: '#6d5b47', lineHeight: 20, marginTop: 8 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  closeButton: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  warnText: { marginTop: 12, color: '#dc2626', fontSize: 12, lineHeight: 18, fontWeight: '700' },
  closeText: { fontWeight: '900', color: '#725d46' },
});
