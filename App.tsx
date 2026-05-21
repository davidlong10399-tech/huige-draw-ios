import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { askAssistant, editImage, generateImage, health, DEFAULT_API_BASE, GenerateResult } from './src/lib/api';

type RefImage = { name: string; dataUrl: string };
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
  const [connected, setConnected] = useState('连接中');
  const [mode, setMode] = useState<Mode>('generate');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1:1');
  const [style, setStyle] = useState('商业海报');
  const [refs, setRefs] = useState<RefImage[]>([]);
  const [assistant, setAssistant] = useState({ message: '告诉我你想画什么，我会帮你补充构图、光影和风格。', chips: ['增强主体', '优化光影', '保留构图'] });
  const [loadingAssistant, setLoadingAssistant] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<GenerateResult[]>([]);

  const fullPrompt = useMemo(() => {
    const extra = stylePrompts[style] || '';
    return [prompt.trim(), extra].filter(Boolean).join('，');
  }, [prompt, style]);

  const checkHealth = useCallback(async () => {
    try {
      const h = await health(apiBase);
      setConnected(`${h.imageModel || 'image'} · ${h.optimizerModel || 'AI'}`);
    } catch (e: any) {
      setConnected(`未连接：${e.message}`);
    }
  }, [apiBase]);

  const refreshAssistant = useCallback(async () => {
    setLoadingAssistant(true);
    try {
      const r = await askAssistant(apiBase, { prompt, mode, refCount: refs.length });
      setAssistant({ message: r.message, chips: r.chips?.length ? r.chips : ['增强主体', '优化光影', '保留构图'] });
    } catch (e: any) {
      setAssistant({ message: `助手暂时不可用：${e.message}`, chips: ['增强主体', '优化光影', '保留构图'] });
    } finally {
      setLoadingAssistant(false);
    }
  }, [apiBase, prompt, mode, refs.length]);

  useEffect(() => { checkHealth(); refreshAssistant(); }, []);

  async function pickImages() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('需要相册权限', '请选择参考图用于图像编辑。');
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, base64: true, quality: 0.92 });
    if (r.canceled) return;
    const next = [...refs];
    for (const asset of r.assets) {
      if (next.length >= 4) break;
      if (!asset.base64) continue;
      const mime = asset.mimeType || 'image/jpeg';
      next.push({ name: asset.fileName || `ref-${Date.now()}.jpg`, dataUrl: `data:${mime};base64,${asset.base64}` });
    }
    setRefs(next);
    if (next.length) setMode('edit');
  }

  async function runGenerate() {
    if (!fullPrompt.trim()) return Alert.alert('先输入提示词');
    if (mode === 'edit' && !refs.length) return Alert.alert('参考图编辑需要先上传图片');
    setGenerating(true);
    try {
      const r = mode === 'edit'
        ? await editImage(apiBase, { prompt: fullPrompt, size, images: refs })
        : await generateImage(apiBase, { prompt: fullPrompt, size });
      setResults([r, ...results]);
    } catch (e: any) {
      Alert.alert('生成失败', e.message || String(e));
    } finally {
      setGenerating(false);
    }
  }

  function editAgain(item: GenerateResult) {
    setRefs([{ name: 'generated-reference.png', dataUrl: item.url }]);
    setMode('edit');
    setPrompt('在这张图基础上，');
  }

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
              <View><Text style={styles.cardTitle}>AI 创作助手</Text><Text style={styles.sub}>真 AI 帮你补提示词和构图</Text></View>
              <Pressable style={styles.smallButton} onPress={refreshAssistant}><Text>{loadingAssistant ? '思考中' : '问助手'}</Text></Pressable>
            </View>
            <View style={styles.assistantBox}>{loadingAssistant ? <ActivityIndicator /> : <Text style={styles.assistantText}>{assistant.message}</Text>}</View>
            <View style={styles.chips}>{assistant.chips.map((c) => <Pressable key={c} style={styles.chip} onPress={() => setPrompt((p) => p ? `${p}，${c}` : c)}><Text style={styles.chipText}>{c}</Text></Pressable>)}</View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>创作参数</Text>
            <View style={styles.segment}>{(['generate', 'edit'] as Mode[]).map(m => <Pressable key={m} style={[styles.segmentItem, mode === m && styles.segmentActive]} onPress={() => setMode(m)}><Text style={mode === m ? styles.segmentTextActive : styles.segmentText}>{m === 'generate' ? '文生图' : '参考图编辑'}</Text></Pressable>)}</View>
            <TextInput style={styles.input} multiline placeholder="输入你想生成的画面" value={prompt} onChangeText={setPrompt} />
            <Text style={styles.label}>风格</Text>
            <View style={styles.chips}>{stylesList.map(s => <Pressable key={s} style={[styles.chip, style === s && styles.chipActive]} onPress={() => setStyle(s)}><Text style={style === s ? styles.chipActiveText : styles.chipText}>{s}</Text></Pressable>)}</View>
            <Text style={styles.label}>比例</Text>
            <View style={styles.chips}>{['1:1', '16:9', '9:16'].map(s => <Pressable key={s} style={[styles.chip, size === s && styles.chipActive]} onPress={() => setSize(s)}><Text style={size === s ? styles.chipActiveText : styles.chipText}>{s}</Text></Pressable>)}</View>
            <Pressable style={styles.upload} onPress={pickImages}><Text style={styles.uploadText}>{refs.length ? `已选 ${refs.length} 张参考图` : '上传参考图'}</Text></Pressable>
            {!!refs.length && <View style={styles.refRow}>{refs.map((r, i) => <Image key={i} source={{ uri: r.dataUrl }} style={styles.refImg} />)}</View>}
            <Pressable style={[styles.generate, generating && styles.disabled]} onPress={runGenerate} disabled={generating}><Text style={styles.generateText}>{generating ? '生成中...' : '开始生成'}</Text></Pressable>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>作品流</Text>
            {!results.length && <Text style={styles.sub}>暂无作品</Text>}
            {results.map((r, i) => <View key={`${r.url}-${i}`} style={styles.resultCard}><Image source={{ uri: r.url }} style={styles.resultImg} /><View style={styles.resultActions}><Pressable style={styles.smallButton} onPress={() => editAgain(r)}><Text>再次修改</Text></Pressable></View></View>)}
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
  input: { minHeight: 130, borderWidth: 1, borderColor: '#eadcc9', borderRadius: 18, padding: 12, backgroundColor: '#fffdf8', marginTop: 14, textAlignVertical: 'top', lineHeight: 22 }, label: { marginTop: 14, fontWeight: '800', color: '#6d5b47' }, upload: { borderWidth: 2, borderStyle: 'dashed', borderColor: '#d8c7b2', backgroundColor: '#fffdf8', borderRadius: 18, minHeight: 78, alignItems: 'center', justifyContent: 'center', marginTop: 14 }, uploadText: { color: '#725d46', fontWeight: '800' }, refRow: { flexDirection: 'row', gap: 8, marginTop: 10 }, refImg: { width: 70, height: 70, borderRadius: 14 }, generate: { height: 54, backgroundColor: '#e56f26', borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: 16 }, disabled: { opacity: 0.6 }, generateText: { color: 'white', fontSize: 16, fontWeight: '900' },
  resultCard: { marginTop: 12, borderRadius: 22, overflow: 'hidden', backgroundColor: 'white', borderWidth: 1, borderColor: '#eadcc9' }, resultImg: { width: '100%', aspectRatio: 1 }, resultActions: { padding: 10, flexDirection: 'row', justifyContent: 'flex-end' },
});
