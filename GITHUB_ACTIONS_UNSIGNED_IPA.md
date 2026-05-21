# GitHub Actions 生成 unsigned IPA

## 目标

用 GitHub 的 macOS runner 自动编译 iOS 真机包，产出：

```txt
huige-draw-unsigned.ipa
```

这个 IPA 不走 Apple 官方签名，适合你后续用越狱机/自签工具处理。

## 已添加工作流

```txt
.github/workflows/build-unsigned-ios.yml
```

## 使用步骤

### 1. 创建 GitHub 仓库

仓库名建议：

```txt
huige-draw-ios
```

可私有仓库。

### 2. 上传项目文件

上传 `F:\Lenovo\ai-studio-ios` 目录下所有内容。

注意：不要上传：

```txt
node_modules
```

### 3. 打开 Actions

进入 GitHub 仓库：

```txt
Actions → Build unsigned iOS IPA → Run workflow
```

### 4. 下载 Artifacts

构建成功后，在 workflow 页面底部下载：

```txt
huige-draw-unsigned-ipa
```

里面就是：

```txt
huige-draw-unsigned.ipa
```

## 如果构建失败

常见原因：

1. Expo SDK 太新，GitHub macOS runner Xcode 版本不匹配
2. CocoaPods 安装失败
3. xcodebuild 对 unsigned archive 限制
4. 某些依赖需要签名阶段才完整生成

失败后把 Actions log 发我，我继续修。
