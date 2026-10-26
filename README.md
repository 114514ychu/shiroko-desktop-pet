# 白子桌宠

Windows 10/11 x64 的 3D 桌宠。支持服装切换、拖动与缩放、原声互动、DeepSeek 对话、聊天历史与长期记忆、提醒，以及可选的本地语音合成和中文语音输入。

作者与上游来源见 [ATTRIBUTION.md](ATTRIBUTION.md)。程序许可证为 [Mulan PSL v2](LICENSE)。本仓库保留原有作者署名与来源记录。

## 下载与使用

本仓库当前版本是代码快照，提取自 2026-10-25 的 1.0.0 便携版，不包含个人 API Key、聊天记录、运行库、模型权重、参考录音或游戏角色素材。它不是该项目原始 Git 历史。

完整步骤见 [Windows 本地部署教程](docs/Windows本地部署.md)。**截至 2026-10-26，GitHub Releases 尚未提供完整便携包**；仅下载本仓库的 Source code ZIP 无法直接运行桌宠。

普通用户拿到完整便携版后：将所有分包 ZIP 解压到同一个父文件夹，允许合并同名的 `ShirokoPet` 目录，然后运行 `ShirokoPet/启动白子桌宠.cmd`。不要只解压一个分包，也不要在 ZIP 内直接运行。便携版不需要另外安装 Node.js 或 Python。

每位用户都需要在设置中填写自己的 DeepSeek API Key。语音服务由桌宠按需启动；兼容 NVIDIA 显卡时优先使用 CUDA，失败后可回退 CPU。实际速度取决于电脑硬件。首次加载会比连续回复慢。

游戏模型、原声、参考录音与音色权重的公开下载，需要另行确认分发授权。本仓库不宣称代码许可证覆盖这些素材。尚未填写或发布任何下载链接。

## 本地开发

需要 Node.js 22 或更新的受支持 LTS、npm，以及用于导入本地素材的 Python 3.10+。

```powershell
npm install
python tools/import-local-assets.py "E:/你的便携版目录"
npm run check
npm start
```

导入命令只从你已有的便携版读取 `resources/app.asar` 中的角色素材和参考录音，不联网下载。运行前需要确认你对这些素材的使用权限。角色素材和参考录音由 `.gitignore` 默认排除；未导入素材时无法显示角色。

本地合成与识别所用的 `GSV-TTS-Lite` 和 `voice-component` 属于独立运行组件，不上传 Git 源码仓库。开发运行时通过设置选择已有组件目录；成品运行时把它们放在 EXE 旁边。不要提交 `Data`、API Key 或自己的聊天记录。

## 构建 Windows 目录版

```powershell
npm run build:win
```

输出位于 `dist/win-unpacked`。构建前需导入角色素材。若要生成完整便携版，再把自己有权分发的 `GSV-TTS-Lite`、`voice-component` 组件放到输出目录，并复制下面的便携模式配置为 `portable.json`：

```json
{"schemaVersion":1,"dataDirectory":"Data"}
```

程序第一次启动会自动创建 `Data`。发布前应在独立副本中排除整个 `Data`，不能以“密钥已加密”为理由将其上传。生成后请在一份全新配置和不同路径下自行验证；本仓库提供的打包配置未在此次整理中重新联网构建。

`npm run check` 是 JavaScript 语法检查。`npm run test:native` 需要完整角色素材和 Electron，在系统临时目录下的独立测试配置中运行原生窗口自检，不使用个人配置；它不是无界面的单元测试。原版记录的 91 项测试属于此前构建验证，不代表本次重新执行了全部测试。

## 功能与数据

完整功能说明保留在 [README-原版功能说明.md](README-原版功能说明.md)。其中 `%APPDATA%` 路径主要对应非便携运行；本次便携版实际将用户数据放在 EXE 旁的 `Data`。

联网聊天会把输入和上下文发送给用户配置的接口。联网查询、文件读取等能力由用户在界面授权。录音识别和合成可在本地完成。请勿在公开 Issue 中粘贴 Key、完整日志或私人对话。

## 许可

- 程序与文档：Mulan PSL v2，保留原版权、作者与免责声明。
- 游戏角色、图像、模型、动画和原声：归各自权利人，另见 [ASSET_RIGHTS.md](ASSET_RIGHTS.md)。
- Electron、Three.js、GSV-TTS-Lite、Python、PyTorch 等：各自许可证独立适用。
- 音色权重和参考录音：不自动获得商业或公开再分发授权。
