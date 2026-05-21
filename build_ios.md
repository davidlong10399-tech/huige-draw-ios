# 打包 iOS .ipa 操作说明

## 你现在的状态

- Expo / React Native 工程已创建
- 依赖已安装
- TypeScript 预检通过
- Expo 配置已可读
- 图标 / 启动图已补齐
- EAS CLI 已可运行

## 目前卡点

`eas whoami` 显示：**Not logged in**

这意味着还不能直接提交 `.ipa` 云打包。

## 你需要做的事

在 `F:\Lenovo\ai-studio-ios` 目录下执行：

```powershell
npx eas-cli login
```

然后登录你的 Expo 账号。

接着执行：

```powershell
npx eas-cli build:configure
```

如果提示 Apple 登录，再按提示登录 Apple Developer 账号。

## 预览包 / 测试包

建议先打 preview：

```powershell
npx eas-cli build --platform ios --profile preview
```

如果要正式 `.ipa`：

```powershell
npx eas-cli build --platform ios --profile production
```

## 说明

- 预览包通常用于内部测试
- production 才是更接近正式 `.ipa`
- 如果要发 TestFlight，还需要 Apple Developer 账号

## 当前工程路径

```txt
F:\Lenovo\ai-studio-ios
```
