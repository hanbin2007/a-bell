# 学校打铃系统（a-bell）设计文档

日期：2026-06-09
状态：待用户评审

## 1. 目标

在 Mac mini 上运行一个常驻的学校打铃系统，到点自动通过 AirPlay 将铃声推送到 HomePod 播放，并提供 Web 管理界面。系统须支持完整的作息管理：多套作息表、按星期生效、节假日/调休、临时停铃、手动打铃。

## 2. 总体方案

- **语言/运行时**：Python 3.13（系统 Homebrew Python），项目内 venv。
- **推流**：[pyatv](https://pyatv.dev) 通过 RAOP/AirPlay 协议直接把音频文件推到 HomePod。
  - 不切换 Mac 系统音频输出，不影响 Mac 本机正在播放的声音。
  - HomePod 采用瞬态配对（transient pairing），每次连接现场握手、不留持久配对记录，**不影响现有 HomeKit 家庭配对**。
  - 若家庭访问控制设为「仅家庭成员」，需在 Home app 改为「同一网络的任何人」或设置 AirPlay 密码；系统配置支持填写密码。
- **Web 框架**：FastAPI + uvicorn，前端为内嵌静态页面（原生 HTML/JS，无构建步骤）。
- **存储**：SQLite（标准库 `sqlite3`），铃声文件存 `data/ringtones/`。
- **常驻**：launchd 用户级 LaunchAgent，开机自启、崩溃自动拉起。

## 3. 组件划分

```
a-bell/
├── abell/
│   ├── main.py          # 入口：启动 FastAPI + 调度器
│   ├── scheduler.py     # 调度引擎：决定何时打铃
│   ├── player.py        # 播放器：pyatv 推流封装（含重试）
│   ├── db.py            # SQLite 访问层与建表
│   ├── api.py           # REST API 路由
│   └── web/             # 静态前端（index.html, app.js, style.css）
├── data/                # 运行时数据（db、铃声），git 忽略
├── tests/
├── launchd/com.zhb.abell.plist
└── docs/
```

### 3.1 调度引擎（scheduler.py）

- asyncio 任务，每 10 秒醒来一次，对照「当前生效作息表」检查是否有到点的打铃项（按分钟精度匹配，同一打铃项每天只触发一次）。
- 当天是否打铃的判定顺序：
  1. 全局「临时停铃」开启 → 全部跳过；
  2. 当天在日历中标记为**节假日** → 跳过；
  3. 当天标记为**调休上班日** → 视为工作日：凡是星期规则覆盖周一~周五中任意一天的打铃项均触发；
  4. 否则按打铃项自身的星期掩码判断。
- 触发后调用播放器，结果写入打铃日志。
- 时间基准：本机本地时区；Mac 处于睡眠则无法打铃（见 §7 部署注意）。

### 3.2 播放器（player.py）

- `pyatv.scan` + `pyatv.connect`，用配置中保存的设备标识连接 HomePod，`stream_file()` 推送铃声文件。
- 支持配置 AirPlay 密码、播放音量（推流前 `set_volume`）。
- 失败重试：最多 3 次，间隔 5 秒；全部失败记录错误日志。
- 并发保护：同一时刻只允许一个推流任务，后到的排队。
- 内置一段程序生成的 2 秒提示音（仅用于「测试设备连通性」按钮，正式铃声一律来自用户上传）。

### 3.3 Web 管理界面 + REST API

单页应用，局域网内手机/电脑均可访问 `http://<mac-ip>:8333`。功能：

| 模块 | 功能 |
|------|------|
| 仪表盘 | 当前作息表、今天是否打铃日、下一次打铃倒计时、临时停铃开关、手动打铃按钮 |
| 作息表 | 多套作息表 CRUD，一键切换生效；表内打铃项：时间、名称（如「第一节上课」）、生效星期、铃声、单项启用开关 |
| 铃声库 | 上传 MP3/WAV/M4A，重命名、删除、网页内试听 |
| 日历 | 按日期添加节假日（跳过）/ 调休上班日（照常），列表管理 |
| 设备 | 扫描局域网 AirPlay 设备、选定 HomePod、填写密码、音量设置、测试播放 |
| 日志 | 打铃历史（时间、项目、成功/失败、错误信息），保留最近 1000 条 |

API 为 `/api/*` 的 JSON 接口，无鉴权（仅监听局域网；见 §6 安全）。

### 3.4 数据模型（SQLite）

- `schedules(id, name, is_active)` — 同时只有一套 `is_active=1`
- `bell_items(id, schedule_id, time "HH:MM", label, weekdays "1111100" 周一~周日七位掩码, ringtone_id, enabled)`
- `ringtones(id, name, filename, created_at)`
- `calendar_overrides(date "YYYY-MM-DD", kind holiday|workday, note)`
- `settings(key, value)` — device_id、airplay_password、volume、suspended 等
- `ring_logs(id, ts, label, status ok|fail, detail)`

## 4. 错误处理

- HomePod 离线/拒绝连接：重试 3 次后记 fail 日志，仪表盘显示最近失败告警。
- 铃声文件丢失：打铃时校验存在性，缺失记 fail 日志。
- 调度器异常：捕获所有异常写日志，循环不退出；launchd KeepAlive 兜底。

## 5. 测试策略

- **单元测试（pytest）**：调度判定逻辑（星期掩码、节假日/调休、停铃、当天去重）、数据层 CRUD。
- **API 测试**：FastAPI TestClient 覆盖各接口，播放器以 mock 注入。
- **真机联调**：HomePod 通电后执行——扫描、配对验证、试播、整点实测。开发期间播放器另提供「本机 afplay 试听」开发模式便于无 HomePod 验证。

## 6. 安全

- 服务监听 `0.0.0.0:8333`（手机可访问），无账号体系——仅限可信的家庭局域网。文件上传校验扩展名与大小上限（20 MB）。

## 7. 部署注意

- launchd LaunchAgent：`RunAtLoad + KeepAlive`，随登录启动。
- **Mac 不能睡眠**否则到点无法打铃：文档提供 `sudo pmset sleep 0`（或仅打铃时段 `pmset repeat wake`）的设置说明。
- 数据目录 `data/` 在仓库外不可见（gitignore），便于备份。

## 8. 非目标（YAGNI）

- 不做多 HomePod 分区/立体声组播报（先支持单设备，立体声对由 Home app 组好后表现为单设备）。
- 不做用户登录、HTTPS。
- 不做 TTS 语音播报、内置铃声库（用户明确只用自己上传的音频）。
