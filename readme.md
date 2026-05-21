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
