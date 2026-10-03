$ErrorActionPreference = 'Stop'
$projectDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pluginDir = Join-Path $projectDir 'plugins\personal-steward'
if (-not (Test-Path -LiteralPath (Join-Path $pluginDir 'dist\mcp.mjs'))) { throw '请先在项目目录执行 npm run build。' }
$codexPath = (Get-Command codex.exe -ErrorAction Stop).Source
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$mcpConfig = @{
  mcpServers = @{
    steward = @{
      command = $nodePath
      args = @((Join-Path $pluginDir 'dist\mcp.mjs'))
      env = @{ STEWARD_DATA_DIR = (Join-Path $projectDir 'data'); STEWARD_WORKSPACE = 'F:\workspace'; STEWARD_BROKER = '1'; STEWARD_PORT = '43187'; STEWARD_CODEX_PATH = $codexPath }
    }
  }
}
[System.IO.File]::WriteAllText((Join-Path $pluginDir '.mcp.json'), ($mcpConfig | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))
& $codexPath plugin marketplace add $projectDir --json
if ($LASTEXITCODE -ne 0) { throw '本地市场注册失败。' }
& $codexPath plugin add 'personal-steward@ling-local' --json
if ($LASTEXITCODE -ne 0) { throw '插件安装失败。' }
Write-Output '灵感工作台 0.3.1 已安装。新聊天会加载工具与工作流技能；桌面侧栏入口可能需要重新打开应用后刷新。'
