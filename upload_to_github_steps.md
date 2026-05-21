# 网页上传到 GitHub 并生成 unsigned IPA

## 1. 创建仓库

打开：

```txt
https://github.com/new
```

建议：

```txt
Repository name: huige-draw-ios
Visibility: Private 或 Public 都可以
不要勾选 Add a README file
不要勾选 .gitignore
不要勾选 license
```

创建后进入仓库页面。

## 2. 上传源码包内容

使用这个包：

```txt
F:\Lenovo\huige-draw-ios-github-actions.zip
```

把 zip 解压后，把里面的所有文件拖到 GitHub 仓库网页上传。

必须包含这些文件：

```txt
.github/workflows/build-unsigned-ios.yml
App.tsx
package.json
package-lock.json
app.json
eas.json
assets/icon.png
assets/splash.png
src/lib/api.ts
```

不要上传：

```txt
node_modules
```

## 3. 触发 Actions

上传完成后，打开：

```txt
Actions → Build unsigned iOS IPA → Run workflow
```

如果第一次看到 Actions 需要启用，点启用。

## 4. 下载 IPA

构建成功后，进入该 workflow run 页面底部：

```txt
Artifacts → huige-draw-unsigned-ipa
```

下载后解压，得到：

```txt
huige-draw-unsigned.ipa
```

## 5. 你自己签名安装

用你的越狱/签名工具对 unsigned IPA 处理。

## 6. 如果失败

把 GitHub Actions 的失败日志复制给我，尤其是最后 100 行。
