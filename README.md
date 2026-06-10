# a-bell 学校打铃系统

## 简介

用 HomePod 打铃的学校打铃系统：FastAPI Web 管理 + asyncio 调度 + pyatv AirPlay 推流。

功能：
- 多作息表管理，支持星期掩码（自定义哪几天响铃）
- 节假日/调休日历覆盖
- 临时停铃（一键暂停全部铃声）
- 手动打铃（随时触发）
- 铃声库（上传、命名、预览）
- 打铃日志（记录每次打铃状态与失败详情）

## 安装

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

开发环境额外安装：

```bash
.venv/bin/pip install -r requirements-dev.txt
```

## 运行

**手动启动：**

```bash
.venv/bin/python -m abell.main
```

默认端口 8333，数据存放在 `./data/`。可用 `--port` 和 `--data` 参数覆盖。

**开机自启（launchd）：**

```bash
cp launchd/com.zhb.abell.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.zhb.abell.plist
```

卸载：

```bash
launchctl unload ~/Library/LaunchAgents/com.zhb.abell.plist
```

## 首次配置

1. 浏览器打开 http://localhost:8333（同局域网手机用 Mac 的 IP 地址）
2. 进入「设备」页，点击「扫描」找到 HomePod，选择并保存
3. 点击「测试播放」确认声音正常
4. 进入「铃声」页，上传铃声文件
5. 进入「作息表」页，新建作息表，添加打铃项并激活

## HomePod 访问控制

打开「家庭」app → 家庭设置 →「允许扬声器和电视访问」，选择以下任一方式：

- **同一网络的任何人**：无需密码，局域网内直接播放
- **要求密码**：设置密码后，在本系统「设备」页的「AirPlay 密码」栏填入同一密码

本系统为纯 AirPlay 客户端（瞬态配对），不影响现有 HomeKit 家庭配对状态。

## 防睡眠（重要）

Mac 进入睡眠时无法打铃，请按需选择以下方案：

**整机不睡眠：**

```bash
sudo pmset -a sleep 0 displaysleep 10
```

**仅在工作日打铃前定时唤醒：**

```bash
sudo pmset repeat wakeorpoweron MTWRF 07:30:00
```

## 铃声格式

支持格式：`.mp3` / `.wav` / `.flac` / `.ogg`，单文件上限 20MB。

不支持 `.m4a` / AAC（pyatv 解码器限制）。

## 开发

运行测试：

```bash
.venv/bin/pytest
```

在「设备」页将 backend 切换为 `afplay` 可在本机调试播放，无需连接 HomePod。

### 前端开发

前端位于 `frontend/`（Vite + React + TypeScript + Tailwind + shadcn/ui），构建产物输出到 `abell/web/`（已随仓库提交，部署无需 Node）：

```bash
cd frontend
npm install
npm run dev      # 开发服务器，/api 代理到 localhost:8333
npm run build    # 构建并覆盖 abell/web/
```

改动前端后需重新 `npm run build` 并提交 `abell/web/`。
