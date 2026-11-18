# termix-ai-claude-bridge

把 Termix 自带的 AI 助手换成 **Claude Code CLI** 引擎：记忆、工具调用、续聊方式都和你在终端里用 `claude` 一致，
但界面仍然长在 Termix 里——对话框、审批卡、主机上下文、多对话切换都在原来的位置。

> 非官方项目。基于 [Termix-SSH/Plugin-AI](https://github.com/Termix-SSH/Plugin-AI)（Apache-2.0）修改而来，
> 与 Termix 官方无隶属关系。改动说明见 `NOTICE`。

---

## 它做了什么

Termix 官方 AI 插件自己维护一套 ReAct 循环，记忆和工具调用都比较简单。本项目把那层循环整个替换成
Claude Code CLI 的子进程，于是你可以得到：

- **真正的 Claude Code 记忆**：用 `--resume <session_id>` 续聊，关掉 Termix 再回来还接着说。
- **按主机隔离的会话**：每台服务器一套对话，换主机就是换上下文，不会串。
- **工具调用看得见**：Claude 调用的 MCP 工具（读主机、跑命令）以卡片形式实时出现在对话里。
- **写操作要你点头**：通过 `--permission-prompt-tool` 把权限请求转成面板上的「允许 / 拒绝」卡片。
- **三档权限模式**：自动（模型自理）／保护（危险命令才问）／手动（每次都问）。
- **多对话管理**：对话下拉、新建、删除；每条对话记住它绑定的服务器，切回去连目标主机一起还原。
- **图片输入**：粘贴或选图，落盘后交给 CLI 的 `Read` 工具识别，图片随对话保存。
- **模型跟随 cc-switch**：读取 `~/.claude/settings.json`，把 Opus/Sonnet/Haiku 三档别名直接做成下拉选项。

## 架构

```
┌──────────────────────── Termix 桌面版 ────────────────────────┐
│                                                              │
│  AI 助手标签页 / 终端右侧面板                                  │
│    ├─ 对话下拉 · 新建 · 删除                                   │
│    ├─ 审批卡（允许 / 拒绝）                                    │
│    └─ 输入框（图片 · 权限模式 · 模型 · 发送）                    │
│                    │ SSE                                      │
│            plugin-ai（本仓库 packages/plugin-ai）              │
│                    │ spawn                                    │
│            claude.exe -p --output-format stream-json          │
│                    │ MCP（stdio）                             │
│            termix-mcp（本仓库 packages/termix-mcp）            │
│                    │ CLI                                      │
│            @termix-ssh/cli  ──►  Termix 后端 API               │
└──────────────────────────────────────────────────────────────┘
```

`termix-mcp` 也可以脱离本插件单独使用，把 Termix 的主机接到 Claude Code、DeepSeek Harness 等任意 MCP 客户端。
见 `packages/termix-mcp/README.md`。

---

## 前置条件

| 依赖 | 说明 |
|---|---|
| Termix 桌面版 | 26.x（插件 API 需要 `--permission-prompt-tool` 对齐的 CLI 版本） |
| Node.js | ≥ 22.12 |
| Claude Code CLI | 已安装并登录；能直接跑 `claude -p "hi"` |
| cc-switch（可选） | 想让它跟随你的模型映射时安装；不装也能用，模型就用 CLI 默认 |

## 安装

```bash
git clone https://github.com/QingZhu233/termix-ai-claude-bridge.git
cd termix-ai-claude-bridge/packages/plugin-ai

# 上游依赖里有需要编译的原生模块，没有 VS Build Tools 时用 --ignore-scripts
npm install --ignore-scripts
npm run build
```

然后在 Termix 里打开 **设置 → 插件 → 开发者模式**，用 API key 安装：

```bash
npx termix-plugin dev \
  --server http://127.0.0.1:30001 \
  --key tmx_你的key
```

安装完成后在插件设置里：

1. 打开 **启用 AI 助手**
2. 把 **引擎** 选成 `claude`
3. 打开 **自动模式**（只读命令免打扰）

重启 Termix。

## 配置

### Claude CLI 路径

默认从 `PATH` 找 `claude.exe`。自定义位置：

```powershell
$env:CLAUDE_CODE_EXE = "C:\path\to\claude.exe"
```

### 模型

如果装了 cc-switch，模型下拉会自动出现三档（读的是 `~/.claude/settings.json`）：

```
Opus · deepseek-v4.1-flash
Sonnet · deepseek-v4.1-flash
Haiku · deepseek-v4.1-flash
```

没装 cc-switch 就不显示，Claude 用 CLI 默认模型。

### termix-mcp 的写权限

MCP 默认 `read-only`，只能跑白名单里的诊断命令。要让它能改主机：

```json
// ~/.termix-mcp.json
{ "allowExec": "all" }
```

改了之后，写操作会走审批卡（自动模式下）或直接执行（手动/自动依你的选择）。

## 权限模式

| 模式 | CLI 参数 | 行为 |
|---|---|---|
| 自动 · 模型自理 | `--permission-mode acceptEdits` | 不挂审批桥，模型自己判断，零打扰 |
| 保护 · 危险才问 | 同上 + 审批桥 | 只有销毁性命令（`rm -rf /`、`mkfs`、`dd`、`shutdown`、`iptables -F` 等）才弹卡 |
| 手动 · 每次问 | `--permission-mode default` | 每个工具调用都弹卡 |

---

## 安全说明（请务必读）

这个插件的能力是**在你的服务器上执行命令**，审批卡是唯一的闸。

- 默认 `allowExec: "read-only"`：只能跑 `df`、`free`、`systemctl status`、`journalctl` 这类只读命令。
- 改成 `"all"` 之后，模型可以执行任意命令，包括 `rm`、`apt install`、改配置。
- **自动模式不弹卡**。如果你同时把 `allowExec` 设成 `all` 并长期用自动模式，等于把 root shell 交给模型。
- 建议：日常用「自动」，但保留 `read-only`；确实要它动手时临时改成 `all`，或切到「保护」模式。

本项目不做任何远程上报，所有调用都发生在你本机：Termix 后端 → `claude.exe` → `termix-mcp` → Termix API。

## 已知限制

- 只有 Claude CLI 是完整实现；内置引擎仍保留但功能较旧。
- 图片存 `~/.termix-ai/images`，不随仓库同步，删除后旧对话里的图会丢失。
- 会话 id 存在插件 KV 里，删除对话时不会一起清（不影响正确性，只是几字节残留）。
- 只在 Windows 上实测过；Linux/macOS 理论上可用（路径与 `claude` 可执行名不同）。

## 许可

Apache License 2.0，见 `LICENSE`。上游署名与改动清单见 `NOTICE`。

## 致谢

- [Termix](https://github.com/Termix-SSH/Termix) —— 宿主平台与插件 API
- [Termix-SSH/Plugin-AI](https://github.com/Termix-SSH/Plugin-AI) —— 本项目的前身
- [cc-switch](https://github.com/farion1231/cc-switch) —— 模型映射与代理切换
