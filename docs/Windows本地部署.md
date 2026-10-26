# 白子桌宠 Windows 本地部署

适用版本：1.0.0，Windows 10/11 64 位。这里的“本地部署”指桌宠、角色渲染、语音合成和中文语音识别在自己的电脑上运行。**DeepSeek 对话仍会访问你配置的在线 API**，除非你自行接入兼容接口的本地模型。

## 先确认下载的是哪一种文件

| 手里的文件 | 能做什么 | 还缺什么 |
| --- | --- | --- |
| 完整便携版的全部 `part01`～`part07` ZIP | 解压后直接运行；内含桌宠、白子/黑子权重、GSV 和中文识别运行时 | 使用在线聊天需要自己的 DeepSeek API Key |
| GitHub 的 Source code ZIP 或本仓库克隆 | 阅读、修改和构建程序 | 角色素材、参考录音、语音运行时及模型权重；不能仅凭源码显示人物和合成白子音色 |

**当前发布状态（2026-10-26）：完整便携版尚未上传 GitHub Releases。**七个完整包目前只在发布者本地准备好，游戏角色素材、原声、参考录音和音色权重的公开再分发权限尚待核对。不要把 GitHub 自动生成的 Source code ZIP 当成完整安装包。

## 方法一：使用完整便携版

拿到有权分发的完整便携包后，按下面步骤安装。完整包有七个**普通、独立的 ZIP**，不是需要专门分卷解压软件的格式。

1. 下载 `ShirokoPet-1.0.0-win-x64-part01.zip` 到 `part07.zip`，以及 `SHA256SUMS.txt`。缺一个包都可能导致角色、声音或运行库缺失。
2. 在本机新建有写入权限的目录，例如 `D:\Apps\WhiteShiroko`。不要放在压缩包内部运行，也不建议放进需要管理员权限写入的 `Program Files`。
3. 将七个 ZIP **逐个解压到同一个父目录**，允许合并同名的 `ShirokoPet` 文件夹。合并后应该是一个完整的 `ShirokoPet`，而不是七个平级的 `ShirokoPet` 副本。
4. 检查 `ShirokoPet` 文件夹里有 `ShirokoPet.exe`、`resources`、`GSV-TTS-Lite`、`voice-component`、`portable.json` 和 `启动白子桌宠.cmd`。其中 `GSV-TTS-Lite` 内应有 `engine.py` 和 `voices`；`voice-component` 内应有 `asr-model`。
5. 双击 `启动白子桌宠.cmd` 或 `ShirokoPet.exe`。第一次启动自动创建同目录的 `Data`；首次准备声音或识别模型可能较慢。

可选：在 PowerShell 中核对下载文件。把当前目录切到七个 ZIP 所在目录，然后运行：

```powershell
Get-Content .\SHA256SUMS.txt | ForEach-Object {
    $hash, $name = $_ -split '\s{2,}', 2
    $actual = (Get-FileHash -LiteralPath $name -Algorithm SHA256).Hash
    if ($actual -ine $hash) { throw "校验失败：$name" }
}
"七个压缩包的 SHA-256 均匹配"
```

### 第一次设置聊天和声音

1. 在桌宠控制台打开“聊天与声音设置”或“应用设置”。默认 DeepSeek 地址为 `https://api.deepseek.com/chat/completions`，模型为 `deepseek-chat`。填写**你自己的** API Key，保存后点“测试已保存的连接”。接口需要网络和可用额度；没有 Key 时，离线角色互动仍可使用。
2. 要让 AI 回复有白子音色，勾选“为聊天回复合成声音”，保存。完整便携版会自动寻找旁边的 `GSV-TTS-Lite`；必要时点“选择”指定该目录，再点“启动并准备语音”检查。
3. 普通、骑行、泳装使用白子权重；黑子使用独立权重。兼容 NVIDIA 显卡时优先 CUDA，失败后尝试 CPU。速度因机器而异。
4. **不用单独打开 GPT-SoVITS，也不用手工启动 9880 或 9881。**程序在聊天时按需拉起本地语音服务，闲置后释放；再次聊天可能需要重新加载。
5. 麦克风输入：Windows 中先选择正确的默认输入设备并允许桌面程序访问麦克风。聊天时点“麦”，看到“正在听”再说话，结束时点“完成”；识别结果进输入框，检查后自行发送。

### 数据与迁移

便携模式的数据写在 `ShirokoPet\Data`：包括设置、聊天历史、助手记忆和加密的 API Key。移动到另一台电脑时可以保留其他个人资料，但 **Windows 当前用户加密的 Key 需要在新电脑重新填写**。分享给别人之前，在程序完全退出后制作副本，并从副本中排除整个 `Data`。不要把自己正在用的 `Data` 上传仓库或发布附件。退出请使用系统托盘菜单；仅关闭控制台窗口不一定会退出桌宠。

## 方法二：从源码运行或构建

这条路线面向开发者。需要 Windows 10/11 x64、Node.js 22 或更新的受支持 LTS、npm、Python 3.10+、可用的网络，以及一份自己有权使用的完整便携版以导入角色素材。当前源码仓库**没有**游戏素材、参考录音和本地语音运行库。

在 PowerShell 中操作：

```powershell
git clone https://github.com/114514ychu/shiroko-desktop-pet.git
Set-Location .\shiroko-desktop-pet
npm install
python .\tools\import-local-assets.py "D:\Apps\WhiteShiroko\ShirokoPet"
npm run check
npm start
```

`import-local-assets.py` 只从你已有的 `resources/app.asar` 读取角色素材及参考录音，不联网下载，并使这些文件继续受 `.gitignore` 排除。路径应指向含 `ShirokoPet.exe` 和 `resources` 的文件夹。未导入素材时，源码程序无法完整显示人物。

`npm run check` 是 JavaScript 语法检查，不代表模型、界面与安装包已通过集成验证。要打包 Windows 目录版，可在素材导入后执行：

```powershell
npm run build:win
```

预计输出为 `dist\win-unpacked`。要变为与完整便携版同类的部署形式，还需要将自己有权使用的 `GSV-TTS-Lite` 和 `voice-component` **完整目录**放在 EXE 旁，并在 EXE 旁创建 `portable.json`：

```json
{"schemaVersion":1,"dataDirectory":"Data"}
```

只复制 `.pth`、`.ckpt` 音色权重不够；GSV 还需要 Python 环境、推理依赖、基础模型和参考录音。`voice-component` 也需要识别模型和运行时。若没有这两套组件，先关闭聊天语音和本地识别功能；角色原声互动与 AI 文字聊天可以分别按其可用条件使用。**本仓库的源码构建与自制完整包尚未做一次新的端到端打包验证**，构建出的 EXE 应在全新目录和独立配置下检查，不能把源码语法检查当作发布验收。

## 常见问题

| 现象 | 先检查 |
| --- | --- |
| 双击没有显示人物 | 是否解压了全部七包、是否只复制 EXE、`resources` 和角色素材是否完整；查看 `Data\diagnostics`。 |
| 聊天没有回复 | 在设置里保存自己的 Key，并使用“测试已保存的连接”；确认服务地址、余额和网络。 |
| 有回复文字但没声音 | 开启“为聊天回复合成声音”；确认 `GSV-TTS-Lite` 目录完整，点击“启动并准备语音”；查看 `Data\voice-service.log`。 |
| 首次声音很慢 | 首次需要加载权重，连续聊天会复用进程；闲置后释放，再用时会重新加载。 |
| 麦克风没有文字 | 确认 Windows 输入设备和权限；点击“麦”后等“正在听”，说完点“完成”；周围人声可能干扰识别。 |
| 换电脑后 Key 失效 | Key 由原 Windows 用户加密，需要在新电脑重新填写。 |
| 想训练其他角色音色 | 当前便携版只负责用现有权重合成；训练需要另外准备 GPT-SoVITS 训练环境、数据和相应授权。 |

程序与文档许可见 [LICENSE](../LICENSE)；游戏角色、动作、原声、模型和参考录音的权利说明见 [ASSET_RIGHTS.md](../ASSET_RIGHTS.md) 及 [ATTRIBUTION.md](../ATTRIBUTION.md)。
