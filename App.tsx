import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { askAssistant, editImage, generateImage, health, DEFAULT_API_BASE, DEFAULT_ASSISTANT_MODEL, DEFAULT_IMAGE_MODEL, DirectApiConfig, GenerateResult, optimizePrompt, RefImage } from './src/lib/api';

type Mode = 'generate' | 'edit';

const stylesList = ['商业海报', '电影感', '真实摄影', '国潮', '产品摄影', '赛博朋克'];
const stylePrompts: Record<string, string> = {
  商业海报: '商业海报设计，强视觉冲击，高级排版，真实光影',
  电影感: '电影感构图，戏剧化光影，浅景深，色彩分级',
  真实摄影: '真实摄影，自然光影，细节丰富，高分辨率',
  国潮: '国潮东方美学，红金色调，精致纹样',
  产品摄影: '高端产品摄影，棚拍灯光，极简背景',
  赛博朋克: '雨夜霓虹，赛博朋克城市，湿润地面反光，高细节',
};

export default function App() {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [apiKey, setApiKey] = useState('');
  const [imageModel, setImageModel] = useState(DEFAULT_IMAGE_MODEL);
  const [assistantModel, setAssistantModel] = useState(DEFAULT_ASSISTANT_MODEL);
  const [showSettings, setShowSettings] = useState(true);
  const [connected, setConnected] = useState('未测试连接');
  const [mode, setMode] = useState<Mode>('generate');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1:1');
  const [style, setStyle] = useState('商业海报');
  const [refs, setRefs] = useState<RefImage[]>([]);
  const [assistant, setAssistant] = useState({ message: '这是直连版：填入接口地址和 API Key 后，App 可直接生图，不依赖电脑后端。', chips: ['增强主体', '优化光影', '保留构图'] });
  const [loadingAssistant, setLoadingAssistant] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [results, setResults] = useState<GenerateResult[]>([]);

  const config: DirectApiConfig = useMemo(() => ({ apiBase, apiKey, imageModel, assistantModel }), [apiBase, apiKey, imageModel, assistantModel]);

  const fullPrompt = useMemo(() => {
    const extra = stylePrompts[style] || '';
    return [prompt.trim(), extra].filter(Boolean).join('，');
  }, [prompt, style]);

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

  const refreshAssistant = useCallback(async () => {
    if (!apiKey.trim()) return Alert.alert('缺少 API Key', '请先在设置里填写 API Key。');
    setLoadingAssistant(true);
    try {
      const r = await askAssistant(config, { prompt, mode, refCount: refs.length });
      setAssistant({ message: r.message, chips: r.chips?.length ? r.chips : ['增强主体', '优化光影', '保留构图'] });
    } catch (e: any) {
      setAssistant({ message: `助手暂时不可用：${e.message}`, chips: ['增强主体', '优化光影', '保留构图'] });
    } finally {
      setLoadingAssistant(false);
    }
  }, [apiKey, config, prompt, mode, refs.length]);

  useEffect(() => { setConnected(apiKey.trim() ? '未测试连接' : '请先填写 API Key'); }, [apiKey]);

  async function pickImages() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('需要相册权限', '请选择参考图用于图像编辑。');
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, quality: 0.92 });
    if (r.canceled) return;
    const next = [...refs];
    for (const asset of r.assets) {
      if (next.length >= 4) break;
      if (!asset.uri) continue;
      next.push({ name: asset.fileName || `ref-${Date.now()}.jpg`, uri: asset.uri, mimeType: asset.mimeType || 'image/jpeg' });
    }
    setRefs(next);
    if (next.length) setMode('edit');
  }

  async function runOptimize() {
    if (!apiKey.trim()) return Alert.alert('缺少 API Key', '请先在设置里填写 API Key。');
    if (!prompt.trim()) return Alert.alert('先输入提示词');
    setOptimizing(true);
    try {
      const r = await optimizePrompt(config, prompt);
      setPrompt(r.optimized);
    } catch (e: any) {
      Alert.alert('优化失败', e.message || String(e));
    } finally {
      setOptimizing(false);
    }
  }

  async function runGenerate() {
    if (!apiKey.trim()) return Alert.alert('缺少 API Key', '请先在设置里填写 API Key。');
    if (!fullPrompt.trim()) return Alert.alert('先输入提示词');
    if (mode === 'edit' && !refs.length) return Alert.alert('参考图编辑需要先上传图片');
    setGenerating(true);
    try {
      const started = Date.now();
      const r = mode === 'edit'
        ? await editImage(config, { prompt: fullPrompt, size, images: refs })
        : await generateImage(config, { prompt: fullPrompt, size });
      setResults([{ ...r, elapsed: Math.round((Date.now() - started) / 1000) }, ...results]);
    } catch (e: any) {
      Alert.alert('生成失败', e.message || String(e));
    } finally {
      setGenerating(false);
    }
  }

  function editAgain(item: GenerateResult) {
    setRefs([{ name: 'generated-reference.png', uri: item.url, mimeType: 'image/png' }]);
    setMode('edit');
    setPrompt('在这张图基础上，');
  }

  const maskedKey = apiKey ? `${apiKey.slice(0, 6)}****${apiKey.slice(-4)}` : '未填写';

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <View style={styles.logo}><Text style={styles.logoText}>辉</Text></View>
            <View style={styles.flex}>
              <Text style={styles.title}>辉哥 Draw</Text>
              <Text style={styles.sub}>{connected}</Text>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <View><Text style={styles.cardTitle}>直连接口设置</Text><Text style={styles.sub}>当前 Key：{maskedKey}</Text></View>
              <Pressable style={styles.smallButton} onPress={() => setShowSettings(v => !v)}><Text>{showSettings ? '收起' : '展开'}</Text></Pressable>
            </View>
            {showSettings && <>
              <Text style={styles.label}>API Base URL</Text>
              <TextInput style={styles.singleInput} autoCapitalize="none" autoCorrect={false} value={apiBase} onChangeText={setApiBase} placeholder="https://api.sharehub.club" />
              <Text style={styles.label}>API Key</Text>
              <TextInput style={styles.singleInput} autoCapitalize="none" autoCorrect={false} secureTextEntry value={apiKey} onChangeText={setApiKey} placeholder="sk-..." />
              <Text style={styles.label}>生图模型</Text>
              <TextInput style={styles.singleInput} autoCapitalize="none" autoCorrect={false} value={imageModel} onChangeText={setImageModel} placeholder="gpt-image-2" />
              <Text style={styles.label}>助手模型</Text>
              <TextInput style={styles.singleInput} autoCapitalize="none" autoCorrect={false} value={assistantModel} onChangeText={setAssistantModel} placeholder="claude-sonnet-4-6" />
              <Pressable style={styles.testButton} onPress={checkHealth}><Text style={styles.testButtonText}>测试连接</Text></Pressable>
            </>}
          </View>

          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <View><Text style={styles.cardTitle}>AI 创作助手</Text><Text style={styles.sub}>直连 chat/completions</Text></View>
              <Pressable style={styles.smallButton} onPress={refreshAssistant}><Text>{loadingAssistant ? '思考中' : '问助手'}</Text></Pressable>
            </View>
            <View style={styles.assistantBox}>{loadingAssistant ? <ActivityIndicator /> : <Text style={styles.assistantText}>{assistant.message}</Text>}</View>
            <View style={styles.chips}>{assistant.chips.map((c) => <Pressable key={c} style={styles.chip} onPress={() => setPrompt((p) => p ? `${p}，${c}` : c)}><Text style={styles.chipText}>{c}</Text></Pressable>)}</View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>创作参数</Text>
            <View style={styles.segment}>{(['generate', 'edit'] as Mode[]).map(m => <Pressable key={m} style={[styles.segmentItem, mode === m && styles.segmentActive]} onPress={() => setMode(m)}><Text style={mode === m ? styles.segmentTextActive : styles.segmentText}>{m === 'generate' ? '文生图' : '参考图编辑'}</Text></Pressable>)}</View>
            <TextInput style={styles.input} multiline placeholder="输入你想生成的画面" value={prompt} onChangeText={setPrompt} />
            <Pressable style={[styles.testButton, optimizing && styles.disabled]} onPress={runOptimize} disabled={optimizing}><Text style={styles.testButtonText}>{optimizing ? '优化中...' : 'AI 优化提示词'}</Text></Pressable>
            <Text style={styles.label}>风格</Text>
            <View style={styles.chips}>{stylesList.map(s => <Pressable key={s} style={[styles.chip, style === s && styles.chipActive]} onPress={() => setStyle(s)}><Text style={style === s ? styles.chipActiveText : styles.chipText}>{s}</Text></Pressable>)}</View>
            <Text style={styles.label}>比例</Text>
            <View style={styles.chips}>{['1:1', '16:9', '9:16'].map(s => <Pressable key={s} style={[styles.chip, size === s && styles.chipActive]} onPress={() => setSize(s)}><Text style={size === s ? styles.chipActiveText : styles.chipText}>{s}</Text></Pressable>)}</View>
            <Pressable style={styles.upload} onPress={pickImages}><Text style={styles.uploadText}>{refs.length ? `已选 ${refs.length} 张参考图` : '上传参考图'}</Text></Pressable>
            {!!refs.length && <View style={styles.refRow}>{refs.map((r, i) => <Image key={i} source={{ uri: r.uri }} style={styles.refImg} />)}</View>}
            <Pressable style={[styles.generate, generating && styles.disabled]} onPress={runGenerate} disabled={generating}><Text style={styles.generateText}>{generating ? '生成中...' : '开始生成'}</Text></Pressable>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>作品流</Text>
            {!results.length && <Text style={styles.sub}>暂无作品</Text>}
            {results.map((r, i) => <View key={`${r.url}-${i}`} style={styles.resultCard}><Image source={{ uri: r.url }} style={styles.resultImg} /><View style={styles.resultActions}><Text style={styles.sub}>{r.elapsed ? `${r.elapsed}s` : ''}</Text><Pressable style={styles.smallButton} onPress={() => editAgain(r)}><Text>再次修改</Text></Pressable></View></View>)}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f5efe6' }, flex: { flex: 1 }, content: { padding: 16, paddingBottom: 42 },
  header: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 14 }, logo: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#e56f26', alignItems: 'center', justifyContent: 'center' }, logoText: { color: 'white', fontWeight: '900', fontSize: 24 }, title: { fontSize: 24, fontWeight: '900', color: '#201915' }, sub: { color: '#8c7a66', fontSize: 12, marginTop: 3 },
  card: { backgroundColor: '#fffaf2', borderWidth: 1, borderColor: '#eadcc9', borderRadius: 24, padding: 16, marginBottom: 14, shadowColor: '#563718', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } }, cardTitle: { fontSize: 17, fontWeight: '900', color: '#201915' }, rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  assistantBox: { minHeight: 88, backgroundColor: '#fffdf8', borderColor: '#eadcc9', borderWidth: 1, borderRadius: 18, padding: 12, marginTop: 12, justifyContent: 'center' }, assistantText: { lineHeight: 22, color: '#201915' }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }, chip: { borderWidth: 1, borderColor: '#eadcc9', backgroundColor: '#fff7ea', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999 }, chipActive: { backgroundColor: '#15110d', borderColor: '#15110d' }, chipText: { color: '#725d46', fontSize: 12 }, chipActiveText: { color: 'white', fontSize: 12 },
  smallButton: { backgroundColor: '#fff7ea', borderWidth: 1, borderColor: '#eadcc9', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 }, segment: { flexDirection: 'row', backgroundColor: '#f5eadc', borderRadius: 16, padding: 4, marginTop: 14 }, segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 13 }, segmentActive: { backgroundColor: '#15110d' }, segmentText: { color: '#725d46' }, segmentTextActive: { color: 'white', fontWeight: '800' },
  input: { minHeight: 130, borderWidth: 1, borderColor: '#eadcc9', borderRadius: 18, padding: 12, backgroundColor: '#fffdf8', marginTop: 14, textAlignVertical: 'top', lineHeight: 22 }, singleInput: { height: 46, borderWidth: 1, borderColor: '#eadcc9', borderRadius: 14, paddingHorizontal: 12, backgroundColor: '#fffdf8', marginTop: 8 }, label: { marginTop: 14, fontWeight: '800', color: '#6d5b47' }, testButton: { height: 46, backgroundColor: '#15110d', borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 14 }, testButtonText: { color: 'white', fontWeight: '900' },
  upload: { borderWidth: 2, borderStyle: 'dashed', borderColor: '#d8c7b2', backgroundColor: '#fffdf8', borderRadius: 18, minHeight: 78, alignItems: 'center', justifyContent: 'center', marginTop: 14 }, uploadText: { color: '#725d46', fontWeight: '800' }, refRow: { flexDirection: 'row', gap: 8, marginTop: 10 }, refImg: { width: 70, height: 70, borderRadius: 14 }, generate: { height: 54, backgroundColor: '#e56f26', borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: 16 }, disabled: { opacity: 0.6 }, generateText: { color: 'white', fontSize: 16, fontWeight: '900' },
  resultCard: { marginTop: 12, borderRadius: 22, overflow: 'hidden', backgroundColor: 'white', borderWidth: 1, borderColor: '#eadcc9' }, resultImg: { width: '100%', aspectRatio: 1 }, resultActions: { padding: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
