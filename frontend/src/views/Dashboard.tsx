import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, BellRing, Check, CircleSlash } from "lucide-react"
import { toast } from "sonner"
import { api, appliesOn, type RingLog, type Schedule, type Status } from "@/api"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"

const KIND_TEXT = {
  normal: "正常打铃日",
  holiday: "节假日 · 不打铃",
  workday: "调休上班日 · 照常打铃",
} as const

function fmtCountdown(total: number): string {
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, "0")
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export default function Dashboard({
  status,
  onChanged,
}: {
  status: Status | null
  onChanged: () => void
}) {
  const [remaining, setRemaining] = useState<number | null>(null)
  const [schedules, setSchedules] = useState<Schedule[] | null>(null)
  const [logs, setLogs] = useState<RingLog[] | null>(null)
  const [ringing, setRinging] = useState(false)
  const bellRef = useRef<SVGSVGElement>(null)

  // 倒计时：以收到 status 的时刻为基准本地递减
  useEffect(() => {
    if (!status?.next_bell) {
      setRemaining(null)
      return
    }
    const target = Date.now() + status.next_bell.seconds * 1000
    const tick = () => {
      const left = Math.max(0, Math.round((target - Date.now()) / 1000))
      setRemaining(left)
      if (left <= 0) onChanged()
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [status, onChanged])

  const loadAux = useCallback(() => {
    api.schedules().then(setSchedules).catch(() => setSchedules([]))
    api.logs(6).then(setLogs).catch(() => setLogs([]))
  }, [])
  useEffect(loadAux, [loadAux])

  // 今日打铃时间轴（与后端 applies_on 同语义，纯展示）
  const todayBells = useMemo(() => {
    if (!status || !schedules) return null
    const active = schedules.find((s) => s.is_active)
    if (!active) return []
    const weekday = (new Date(`${status.today.date}T00:00:00`).getDay() + 6) % 7
    return active.items
      .filter((it) => appliesOn(it, weekday, status.today.kind))
      .sort((a, b) => a.time.localeCompare(b.time))
  }, [status, schedules])

  const nowHM = new Date().toTimeString().slice(0, 5)

  const manualRing = async () => {
    setRinging(true)
    try {
      await api.ring()
      bellRef.current?.classList.remove("bell-swing")
      void bellRef.current?.getBoundingClientRect().width
      bellRef.current?.classList.add("bell-swing")
      toast.success("已开始打铃")
      setTimeout(() => api.logs(6).then(setLogs).catch(() => {}), 2500)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRinging(false)
    }
  }

  const toggleSuspend = async (v: boolean) => {
    try {
      await api.suspend(v)
      toast.success(v ? "已临时停铃" : "已恢复打铃")
      onChanged()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  if (!status) {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-52 lg:col-span-2" />
        <Skeleton className="h-52" />
        <Skeleton className="h-36 lg:col-span-3" />
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* 主倒计时 */}
      <Card className="fade-up relative overflow-hidden lg:col-span-2" style={{ animationDelay: "0ms" }}>
        <div className="pointer-events-none absolute -top-20 -right-20 size-56 rounded-full bg-primary/8 blur-2xl" />
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <span className={cn("size-2 rounded-full", status.suspended ? "bg-destructive" : "bg-primary pulse-dot")} />
            下次打铃
          </CardTitle>
        </CardHeader>
        <CardContent>
          {status.suspended ? (
            <div className="flex items-center gap-4 py-3">
              <CircleSlash className="size-10 text-destructive/70" />
              <div>
                <div className="font-heading text-3xl font-semibold text-destructive">已临时停铃</div>
                <p className="mt-1 text-sm text-muted-foreground">恢复开关在右侧「快速操作」中</p>
              </div>
            </div>
          ) : status.next_bell && remaining !== null ? (
            <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
              <div className="font-mono text-6xl leading-none font-semibold tracking-tight tabular-nums sm:text-7xl">
                {fmtCountdown(remaining)}
              </div>
              <div className="pb-1">
                <div className="font-heading text-lg font-medium">{status.next_bell.label}</div>
                <div className="font-mono text-sm text-muted-foreground tabular-nums">
                  {status.next_bell.time.replace("T", " ")}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-3">
              <div className="font-heading text-3xl font-semibold text-muted-foreground">近两周无待打铃</div>
              <p className="mt-1 text-sm text-muted-foreground">请在「作息表」中添加打铃项并激活作息表</p>
            </div>
          )}
          {status.last_fail && (
            <div className="mt-5 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>
                <span className="font-medium text-destructive">最近失败：</span>
                <span className="font-mono text-xs tabular-nums">{status.last_fail.ts}</span>{" "}
                {status.last_fail.label} — {status.last_fail.detail}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 快速操作 */}
      <Card className="fade-up" style={{ animationDelay: "60ms" }}>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">快速操作</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Button className="h-12 w-full text-base" onClick={manualRing} disabled={ringing}>
            <BellRing ref={bellRef} className="size-5" />
            立即打铃
          </Button>
          <div className="flex items-center justify-between rounded-md border px-3 py-3">
            <div>
              <div className="text-sm font-medium">临时停铃</div>
              <div className="text-xs text-muted-foreground">考试等场景一键静默</div>
            </div>
            <Switch checked={status.suspended} onCheckedChange={toggleSuspend} />
          </div>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">当前作息表</dt>
              <dd className="font-medium">{status.active_schedule?.name ?? "未设置"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">今天 {status.today.date}</dt>
              <dd
                className={cn(
                  "font-medium",
                  status.today.kind === "holiday" && "text-destructive",
                  status.today.kind === "workday" && "text-primary",
                )}
              >
                {KIND_TEXT[status.today.kind]}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* 今日时间轴 */}
      <Card className="fade-up lg:col-span-3" style={{ animationDelay: "120ms" }}>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">今日打铃安排</CardTitle>
          <CardDescription>
            {todayBells === null
              ? "加载中…"
              : status.today.kind === "holiday"
                ? "今天是节假日，所有打铃跳过"
                : status.suspended
                  ? "已临时停铃，以下时间点今天不会触发"
                  : `共 ${todayBells.length} 次`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {todayBells && todayBells.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {todayBells.map((b) => {
                const past = b.time <= nowHM
                const isNext =
                  !status.suspended &&
                  status.next_bell?.time.slice(0, 10) === status.today.date &&
                  status.next_bell?.time.slice(11, 16) === b.time
                return (
                  <div
                    key={b.id}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-2",
                      isNext
                        ? "border-primary/50 bg-accent text-accent-foreground shadow-sm"
                        : past
                          ? "opacity-45"
                          : "bg-card",
                      status.suspended && "opacity-45",
                    )}
                  >
                    {past && !isNext && <Check className="size-3.5 text-ok" />}
                    <span className="font-mono text-sm font-semibold tabular-nums">{b.time}</span>
                    <span className="text-sm">{b.label || "（未命名）"}</span>
                    {isNext && (
                      <Badge className="ml-1 px-1.5 py-0 text-[10px]" variant="default">
                        下一个
                      </Badge>
                    )}
                  </div>
                )
              })}
            </div>
          ) : todayBells ? (
            <p className="text-sm text-muted-foreground">今天没有打铃安排。</p>
          ) : (
            <Skeleton className="h-10" />
          )}
        </CardContent>
      </Card>

      {/* 最近日志 */}
      <Card className="fade-up lg:col-span-3" style={{ animationDelay: "180ms" }}>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">最近打铃</CardTitle>
        </CardHeader>
        <CardContent>
          {logs && logs.length > 0 ? (
            <ul className="divide-y">
              {logs.map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-2 text-sm">
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      l.status === "ok" ? "bg-ok" : "bg-destructive",
                    )}
                  />
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">{l.ts}</span>
                  <span className="font-medium">{l.label}</span>
                  {l.detail && <span className="truncate text-xs text-muted-foreground">{l.detail}</span>}
                </li>
              ))}
            </ul>
          ) : logs ? (
            <p className="text-sm text-muted-foreground">还没有打铃记录。</p>
          ) : (
            <Skeleton className="h-16" />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
