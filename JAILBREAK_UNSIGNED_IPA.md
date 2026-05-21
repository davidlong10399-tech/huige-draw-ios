# 越狱机 / 自签 IPA 路线

你说 iOS 是越狱机，签名你有办法。那我们目标变成：

> 先拿到 iOS 真机 arm64 的未签名 IPA / 可重签 IPA，然后你用自己的工具签名安装。

## 关键点

Windows 不能本地编译 iOS 真机包，因为 iOS 编译需要：

- macOS
- Xcode
- iOS SDK
- CocoaPods

EAS 云打包默认也需要 Apple 凭据来产出设备 `.ipa`，不太适合“先给我未签名 IPA”。

## 我已准备的脚本

```txt
scripts/build-unsigned-ipa-macos.sh
```

这个脚本用于 macOS：

1. 安装依赖
2. `expo prebuild --platform ios --clean`
3. `pod install`
4. `xcodebuild archive`，关闭签名
5. 打包成：

```txt
ios/build/huige-draw-unsigned.ipa
```

然后你再用自己的越狱/自签工具处理。

## macOS 上执行

```bash
cd ai-studio-ios
chmod +x scripts/build-unsigned-ipa-macos.sh
./scripts/build-unsigned-ipa-macos.sh
```

## 如果你有 .p12 + mobileprovision

如果你不是“后签名”，而是已经有：

- `.p12` 证书
- `.mobileprovision`
- p12 密码

那也可以继续走 EAS，选择提供现有凭据，让 EAS 直接产出已签 IPA。

## 如果只有 Windows

纯 Windows 本机无法编译 iOS 真机二进制。可选方案：

1. 借一台 Mac 跑上面的脚本
2. 用云 Mac / GitHub Actions macOS runner
3. 提供 p12 + mobileprovision 继续走 EAS
4. 暂时用 Expo Go / PWA 预览
