import { useCallback, useEffect, useState } from "react"
import {
  BellRing,
  CalendarDays,
  CalendarClock,
  LayoutDashboard,
  Music4,
  ScrollText,
  Speaker,
} from "lucide-react"
import { api, type Status } from "@/api"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import Dashboard from "@/views/Dashboard"
import Schedules from "@/views/Schedules"
import Ringtones from "@/views/Ringtones"
import CalendarView from "@/views/CalendarView"
import DeviceView from "@/views/DeviceView"
import LogsView from "@/views/LogsView"

const NAV = [
  { key: "dashboard", label: "仪表盘", desc: "运行状态与下一次打铃", icon: LayoutDashboard },
  { key: "schedules", label: "作息表", desc: "课表与打铃时间点", icon: CalendarClock },
  { key: "ringtones", label: "铃声库", desc: "上传与管理铃声", icon: Music4 },
  { key: "calendar", label: "日历", desc: "节假日与调休", icon: CalendarDays },
  { key: "device", label: "设备", desc: "HomePod 连接与播放设置", icon: Speaker },
  { key: "logs", label: "日志", desc: "打铃历史记录", icon: ScrollText },
] as const

type ViewKey = (typeof NAV)[number]["key"]

export default function App() {
  const [view, setView] = useState<ViewKey>(() => {
    const h = window.location.hash.slice(1)
    return (NAV.some((n) => n.key === h) ? h : "dashboard") as ViewKey
  })
  const [status, setStatus] = useState<Status | null>(null)

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.status())
    } catch {
      /* 状态轮询失败静默，仪表盘有显式错误位 */
    }
  }, [])

  useEffect(() => {
    refreshStatus()
    const t = setInterval(refreshStatus, 15000)
    return () => clearInterval(t)
  }, [refreshStatus])

  const go = (key: ViewKey) => {
    setView(key)
    window.location.hash = key
  }

  const active = NAV.find((n) => n.key === view)!

  return (
    <div className="grain flex min-h-screen">
      {/* 侧栏（桌面） */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-3 px-5 pt-6 pb-5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-md">
            <BellRing className="size-5" />
          </div>
          <div>
            <div className="font-heading text-base font-semibold tracking-wide">a-bell</div>
            <div className="text-[11px] tracking-widest text-sidebar-foreground/50 uppercase">
              School Bell Console
            </div>
          </div>
        </div>
        <div className="mx-5 mb-3 h-px bg-sidebar-border" />
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((n) => (
            <button
              key={n.key}
              onClick={() => go(n.key)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                view === n.key
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-sm"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              <n.icon
                className={cn("size-4", view === n.key ? "text-sidebar-primary" : "opacity-70")}
              />
              {n.label}
              {n.key === "dashboard" && status?.suspended && (
                <span className="ml-auto size-1.5 rounded-full bg-destructive" />
              )}
            </button>
          ))}
        </nav>
        <div className="px-5 py-4 text-[11px] leading-relaxed text-sidebar-foreground/40">
          {status ? (
            <>
              <div>
                当前作息表：
                <span className="text-sidebar-foreground/70">
                  {status.active_schedule?.name ?? "未设置"}
                </span>
              </div>
              <div>
                状态：
                <span
                  className={cn(
                    status.suspended ? "text-destructive" : "text-sidebar-primary",
                  )}
                >
                  {status.suspended ? "已停铃" : "运行中"}
                </span>
              </div>
            </>
          ) : (
            "连接中…"
          )}
        </div>
      </aside>

      {/* 主区域 */}
      <div className="flex min-w-0 flex-1 flex-col md:pl-60">
        {/* 顶栏（移动端含导航） */}
        <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3 md:px-8">
            <div className="flex size-7 items-center justify-center rounded-md bg-sidebar text-sidebar-primary md:hidden">
              <BellRing className="size-4" />
            </div>
            <div className="min-w-0">
              <h1 className="font-heading truncate text-lg font-semibold">{active.label}</h1>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">{active.desc}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {status?.suspended && <Badge variant="destructive">已临时停铃</Badge>}
              {status?.last_fail && view !== "dashboard" && (
                <Badge variant="outline" className="border-destructive/40 text-destructive">
                  最近打铃失败
                </Badge>
              )}
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:hidden">
            {NAV.map((n) => (
              <button
                key={n.key}
                onClick={() => go(n.key)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs",
                  view === n.key
                    ? "bg-primary font-medium text-primary-foreground"
                    : "bg-secondary text-secondary-foreground",
                )}
              >
                <n.icon className="size-3.5" />
                {n.label}
              </button>
            ))}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8">
          {view === "dashboard" && <Dashboard status={status} onChanged={refreshStatus} />}
          {view === "schedules" && <Schedules onChanged={refreshStatus} />}
          {view === "ringtones" && <Ringtones />}
          {view === "calendar" && <CalendarView onChanged={refreshStatus} />}
          {view === "device" && <DeviceView />}
          {view === "logs" && <LogsView />}
        </main>
      </div>
    </div>
  )
}
