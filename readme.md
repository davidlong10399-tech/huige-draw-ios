# 辉哥 Draw 原生 iOS App

这是 `F:\Lenovo\ai-studio` 的原生 iOS 客户端雏形，采用 Expo / React Native。

## 当前能力

- AI 创作助手
- 文生图
- 参考图上传
- 参考图编辑
- 生成结果展示
- 再次修改
- 连接本地 AI Studio 后端：`http://192.168.2.104:8848`

## v0.5.0 · GPT Image 2.5 适配（2026-09）

- 默认生图模型升级为 `gpt-image-2.5-flare`，设置内可一键切换 `gpt-image-2.5-sunburst`（高画质）或回退 `gpt-image-2`
- 新增**画质**选择：`auto / low / medium / high / xhigh / max`（`xhigh`、`max` 为 2.5 新增档位；仅在模型为 gpt-image 系列时显示并随请求发送）
- 尺寸表对齐 2.5 硬约束：每边均为 16 的倍数、单边 ≤ 3840px、长短边比例 ≤ 3:1、总像素 655,360–8,294,400
  - 修复旧表违规值：`1024x1365`（1365 非 16 倍数）→ `864x1152`；`4096x4096`（超上限）→ `2880x2880` 等
- 移除 `response_format` 参数：gpt-image 系列官方 API 不接受该字段（默认即返回 b64_json），旧请求在直连官方端点时会报 `Unknown parameter`
- 旧配置自动迁移：存档中的 `gpt-image-2` 默认模型升级为 2.5 Flare，自定义模型名不受影响
- 画质为请求级参数，不再依赖提示词内堆砌"8K/超清"等形容词

## Windows 上预览

```powershell
cd F:\Lenovo\ai-studio-ios
npm install
npm run start
```

然后用手机安装 Expo Go 扫码预览。

## 打包 iOS

需要 Expo/EAS 账号和 Apple Developer 账号：

```powershell
npm install -g eas-cli
eas login
eas build --platform ios --profile preview
```

## 重要：本地后端访问

当前后端 `F:\Lenovo\ai-studio` 仍监听 `127.0.0.1`，手机访问不到。

如需真机访问，需要把后端监听改成 `0.0.0.0`，并确认防火墙允许局域网访问。这个改动会让同 Wi-Fi 设备可访问生图服务，需用户确认。

## 后续增强

- 保存图片到相册
- App 内配置 API 地址
- 登录/访问密码
- 生成历史持久化
- 深色模式
- TestFlight 内测包
