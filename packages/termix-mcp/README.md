# termix-mcp

把你的 Termix 主机（连同它的凭据、权限、审计）暴露成一个**本地 stdio MCP 服务**，给 Claude Code 和 DeepSeek Harness 用。

- **按需启动**：客户端拉起进程，会话结束就退出。没有端口、没有守护进程、没有开机自启。
- **能关**：`enabled: false`，或者把客户端里的 MCP 条目删掉，就等于不存在。
- **零依赖**：只需要 Node ≥ 18，不用 `npm install` 装任何东西，没有构建步骤。
- **密钥不出本机**：API key 只通过环境变量传给 Termix CLI，不进命令行参数、不进日志、不进工具结果。

它做的事情只有一件：**把 Termix CLI 翻译成 MCP 工具**。主机、凭据、权限、审计仍然全部由 Termix 管——所以你在 Termix 里撤销一把 key、关掉一台主机，这里立刻生效。

## 已验证（2026-11-16）

| 环节 | 状态 |
|---|---|
| Termix 桌面后端 | `26.11.1`，19 个插件，`health: ok` |
| API key | Full access |
| 主机清单 | 8 台，`web-01` = id `3` |
| 执行链路 | `df -h` 在 `web-01` 上返回真实输出，exit 0 |
| 告警/插件/片段 | 未逐一验证 |
| DSH | 已挂载，工具名 `mcp__termix__*`，本会话内实测可用 |
| Claude Code | `claude mcp list` → `termix … √ Connected` |

## 前置

1. Termix 正在运行。桌面版内置后端默认在 `http://127.0.0.1:30001`；自托管实例是 `https://你的地址`。
2. 装好官方 CLI：
   ```powershell
   npm install -g @termix-ssh/cli
   termix --version
   ```
3. 在 Termix 里生成一把 API key：**设置 → API keys → 新建**（管理员）。复制 `tmx_` 开头的那串。

## 安装（三次命令）

```powershell
cd <repo>\packages\termix-mcp

# 1. 写配置 + 试连
node setup.mjs --url http://127.0.0.1:30001 --key tmx_你的key --exec read-only

# 2. 单独复测（改了配置之后随时跑）
node setup.mjs --test
```

第 1 步会写出 `%USERPROFILE%\.termix-mcp.json`，并打印两边客户端的接入命令。

## 接入客户端

### Claude Code

```powershell
claude mcp add termix -s user -- "node" "<repo>\packages\termix-mcp\bin\termix-mcp.mjs"
```

（`node setup.mjs` 会按你机器上的真实路径打印这一行，直接复制即可。）

### DeepSeek Harness

设置 → MCP → 新增，或直接写进 profile：

```yaml
- insert:
    - id: termix-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: termix
        transport: stdio
        command: 'node'
        args: ['<repo>\packages\termix-mcp\bin\termix-mcp.mjs']
        failOnStartupError: true
```

工具会以 `mcp__termix__termix_hosts` 这种名字出现。

## 工具

| 工具 | 作用 | 需要 exec 模式 |
|---|---|---|
| `termix_version` | CLI 版本 + 服务端健康状态，排障第一站 | 否 |
| `termix_hosts` | 主机列表（id / 地址 / 用户 / 标签），可带 `query` 过滤 | 否 |
| `termix_host_get` | 单台主机配置，凭据不会打印 | 否 |
| `termix_status` | 在线/离线 | 否 |
| `termix_snippets` | 已保存的命令片段 | 否 |
| `termix_alerts` | 告警收件箱 | 否 |
| `termix_fleets` | 主机分组 | 否 |
| `termix_plugins` | 服务端开了哪些插件 | 否 |
| `termix_exec` | 在主机上执行命令 | 是 |
| `termix_fleet_exec` | 在一个分组的所有主机上执行 | 是 |

## 三种命令模式

配置文件里的 `allowExec`：

| 值 | 行为 |
|---|---|
| `off` | `termix_exec` / `termix_fleet_exec` 根本不出现在工具列表里 |
| `read-only`（默认） | 单条命令，**不许** `; & \| \` $ > <`；只放行 `df`、`du`、`free`、`uptime`、`ps`、`ls`、`ss`、`journalctl`、`systemctl status`、`docker ps/logs`、`cat /proc\|/sys\|/etc` 等 |
| `all` | 任意命令 |

**为什么默认是 read-only**：你的主机是 root 登录。`all` 等于把 root shell 交给模型，一句幻觉就是事故。真要做变更操作时，临时改成 `all`，做完改回来。

## 配置

`%USERPROFILE%\.termix-mcp.json`：

```json
{
  "enabled": true,
  "url": "http://127.0.0.1:30001",
  "apiKey": "tmx_...",
  "allowExec": "read-only",
  "maxOutput": 4000,
  "timeoutMs": 60000,
  "hosts": []
}
```

| 字段 | 说明 |
|---|---|
| `enabled` | `false` 时工具列表为空，等于关闭 |
| `hosts` | 只允许这些 host id，`[]` 表示全部 |
| `maxOutput` | 单次结果保留的字符数，超了掐中间、保留头尾 |
| `timeoutMs` | 单次 CLI 调用上限 |

环境变量优先级更高：`TERMIX_URL`、`TERMIX_API_KEY`、`TERMIX_MCP_ALLOW_EXEC`、`TERMIX_MCP_MAX_OUTPUT`、`TERMIX_MCP_HOSTS`、`TERMIX_MCP_CONFIG`、`TERMIX_CLI_JS`。

## 开关

- **临时关**：`enabled: false`，重启客户端会话。
- **彻底关**：把客户端配置里那一条删掉，进程再也不会被拉起。
- **只读关**：`allowExec: "off"`。

没有常驻进程可关——它只活在客户端会话里。

## 排障

| 现象 | 原因 |
|---|---|
| `Not authenticated` | key 没写进配置，或已被撤销 |
| 退出码 8 | 对应插件没开（例如 `exec` 需要 Snippets 插件） |
| `timed out after 60000 ms` | 远端命令太久；换 `termix_exec` 的 `timeoutMs`，或改用 Termix 里的长任务 |
| 工具列表里没有 `termix_exec` | `allowExec` 是 `off` |
| 命令被拒 | read-only 模式的白名单/单命令限制，看返回里的具体原因 |

## 它不是什么

- 不是常驻服务，不监听端口，不开后台任务。
- 不是 Termix 的替代品：它没有界面，一切变更仍然要在 Termix 里看。
- 不管凭据：它看不到 SSH 密码，也打印不出来（CLI 会脱敏）。
