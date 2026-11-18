# 接入示例

## Claude Code

```powershell
# 用户级（所有项目可用）
claude mcp add termix -s user -- "node" "<repo>\packages\termix-mcp\bin\termix-mcp.mjs"

# 查看
claude mcp list

# 移除（等于关闭）
claude mcp remove termix -s user
```

## DeepSeek Harness

两种做法，选一个。

### A. 设置面板（推荐）

设置 → MCP → 新增服务器：

```json
{
  "termix": {
    "transport": "stdio",
    "command": "D:\\code\\nodejs\\node.exe",
    "args": [
      "<repo>\\packages\\termix-mcp\\bin\\termix-mcp.mjs"
    ],
    "enabled": true
  }
}
```

### B. profile 补丁

`cordis.patch.yml`：

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

工具名形如 `mcp__termix__termix_hosts`。

## 第一次对话怎么试

```
用 termix 列一下我有哪几台主机
```

```
在 web-01 上看看磁盘和内存，再告诉我哪个服务在报错
```

```
帮我把 nginx 配置里的 worker_processes 改成 4
```

第三条在 `read-only` 下会被挡下来，返回里会说明原因——这是设计如此。真要改：

1. 把 `~/.termix-mcp.json` 的 `allowExec` 改成 `"all"`；
2. 重开一个会话（MCP 进程是客户端拉起的，重启会话才读到新配置）；
3. 改完改回 `"read-only"`。

## 想更严格

只放行一台机器：

```json
{ "hosts": ["3"] }
```

配合 `allowExec: "read-only"`，就是一个"只能看、只能看这一台"的只读探针。
