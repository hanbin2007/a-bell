import { useCallback, useEffect, useState } from "react"
import { CalendarClock, Check, Plus, Save, Star, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { api, WEEKDAY_LABELS, type BellItem, type Ringtone, type Schedule } from "@/api"
import { cn } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"

type Draft = { time: string; label: string; weekdays: string; ringtone_id: number | null; enabled: boolean }

const EMPTY_DRAFT: Draft = { time: "08:00", label: "", weekdays: "1111100", ringtone_id: null, enabled: true }

function toDraft(it: BellItem): Draft {
  return {
    time: it.time,
    label: it.label,
    weekdays: it.weekdays,
    ringtone_id: it.ringtone_id,
    enabled: Boolean(it.enabled),
  }
}

function WeekdayPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1">
      {WEEKDAY_LABELS.map((w, i) => (
        <button
          key={w}
          type="button"
          onClick={() => {
            const arr = value.split("")
            arr[i] = arr[i] === "1" ? "0" : "1"
            onChange(arr.join(""))
          }}
          className={cn(
            "size-7 rounded-md border text-xs transition-colors",
            value[i] === "1"
              ? "border-primary/50 bg-accent font-semibold text-accent-foreground"
              : "bg-card text-muted-foreground hover:bg-secondary",
          )}
        >
          {w}
        </button>
      ))}
    </div>
  )
}

function ItemEditor({
  draft,
  ringtones,
  onChange,
}: {
  draft: Draft
  ringtones: Ringtone[]
  onChange: (d: Draft) => void
}) {
  return (
    <>
      <Input
        type="time"
        value={draft.time}
        onChange={(e) => onChange({ ...draft, time: e.target.value })}
        className="w-28 font-mono tabular-nums"
      />
      <Input
        placeholder="如：第一节上课"
        value={draft.label}
        onChange={(e) => onChange({ ...draft, label: e.target.value })}
        className="w-40 flex-1 sm:flex-none"
      />
      <WeekdayPicker value={draft.weekdays} onChange={(v) => onChange({ ...draft, weekdays: v })} />
      <Select
        value={draft.ringtone_id === null ? "none" : String(draft.ringtone_id)}
        onValueChange={(v) => onChange({ ...draft, ringtone_id: v === "none" ? null : Number(v) })}
      >
        <SelectTrigger className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">（无铃声）</SelectItem>
          {ringtones.map((r) => (
            <SelectItem key={r.id} value={String(r.id)}>
              {r.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-1.5">
        <Switch checked={draft.enabled} onCheckedChange={(v) => onChange({ ...draft, enabled: v })} />
        <span className="text-xs text-muted-foreground">{draft.enabled ? "启用" : "停用"}</span>
      </div>
    </>
  )
}

export default function Schedules({ onChanged }: { onChanged: () => void }) {
  const [schedules, setSchedules] = useState<Schedule[] | null>(null)
  const [ringtones, setRingtones] = useState<Ringtone[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [newItem, setNewItem] = useState<Draft>(EMPTY_DRAFT)
  const [newName, setNewName] = useState("")
  const [renameTo, setRenameTo] = useState("")
  const [dlgNew, setDlgNew] = useState(false)
  const [dlgRename, setDlgRename] = useState(false)

  const load = useCallback(async () => {
    try {
      const [ss, rs] = await Promise.all([api.schedules(), api.ringtones()])
      setSchedules(ss)
      setRingtones(rs)
      setDrafts(Object.fromEntries(ss.flatMap((s) => s.items.map((it) => [it.id, toDraft(it)]))))
      setSelectedId((cur) =>
        cur !== null && ss.some((s) => s.id === cur)
          ? cur
          : (ss.find((s) => s.is_active)?.id ?? ss[0]?.id ?? null),
      )
    } catch (e) {
      toast.error((e as Error).message)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast.success(ok)
      await load()
      onChanged()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  if (!schedules) return <Skeleton className="h-72" />

  const selected = schedules.find((s) => s.id === selectedId) ?? null

  return (
    <div className="space-y-4">
      {/* 作息表选择条 */}
      <div className="fade-up flex flex-wrap items-center gap-2">
        {schedules.map((s) => (
          <button
            key={s.id}
            onClick={() => setSelectedId(s.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors",
              s.id === selectedId
                ? "border-primary/50 bg-accent font-medium text-accent-foreground shadow-sm"
                : "bg-card hover:bg-secondary",
            )}
          >
            {Boolean(s.is_active) && <Star className="size-3.5 fill-primary text-primary" />}
            {s.name}
            <span className="text-xs text-muted-foreground">{s.items.length}</span>
          </button>
        ))}
        <Dialog open={dlgNew} onOpenChange={setDlgNew}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus className="size-4" /> 新建作息表
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>新建作息表</DialogTitle>
            </DialogHeader>
            <Input
              placeholder="如：夏季作息"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <DialogFooter>
              <Button
                disabled={!newName.trim()}
                onClick={() =>
                  run(async () => {
                    const { id } = await api.createSchedule(newName.trim())
                    setSelectedId(id)
                    setNewName("")
                    setDlgNew(false)
                  }, "已创建")
                }
              >
                创建
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {selected ? (
        <Card className="fade-up" style={{ animationDelay: "60ms" }}>
          <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              {selected.name}
              {Boolean(selected.is_active) ? (
                <Badge>生效中</Badge>
              ) : (
                <Badge variant="secondary">未生效</Badge>
              )}
            </CardTitle>
            <div className="ml-auto flex gap-2">
              {!selected.is_active && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => run(() => api.activateSchedule(selected.id), "已切换生效作息表")}
                >
                  <Check className="size-4" /> 设为生效
                </Button>
              )}
              <Dialog
                open={dlgRename}
                onOpenChange={(v) => {
                  setDlgRename(v)
                  if (v) setRenameTo(selected.name)
                }}
              >
                <DialogTrigger asChild>
                  <Button size="sm" variant="ghost">
                    改名
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-sm">
                  <DialogHeader>
                    <DialogTitle>重命名作息表</DialogTitle>
                  </DialogHeader>
                  <Input value={renameTo} onChange={(e) => setRenameTo(e.target.value)} />
                  <DialogFooter>
                    <Button
                      disabled={!renameTo.trim()}
                      onClick={() =>
                        run(async () => {
                          await api.renameSchedule(selected.id, renameTo.trim())
                          setDlgRename(false)
                        }, "已重命名")
                      }
                    >
                      保存
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={Boolean(selected.is_active)}>
                    <Trash2 className="size-4" /> 删除
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>删除「{selected.name}」？</AlertDialogTitle>
                    <AlertDialogDescription>
                      其中 {selected.items.length} 个打铃项将一并删除，此操作不可恢复。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction onClick={() => run(() => api.deleteSchedule(selected.id), "已删除")}>
                      删除
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {selected.items.length === 0 && (
              <p className="py-2 text-sm text-muted-foreground">还没有打铃项，在下方添加第一个。</p>
            )}
            {selected.items.map((it) => {
              const d = drafts[it.id] ?? toDraft(it)
              const dirty = JSON.stringify(d) !== JSON.stringify(toDraft(it))
              return (
                <div
                  key={it.id}
                  className={cn(
                    "flex flex-wrap items-center gap-2 rounded-md border px-3 py-2.5",
                    !d.enabled && "bg-muted/40",
                    dirty && "border-primary/40",
                  )}
                >
                  <ItemEditor
                    draft={d}
                    ringtones={ringtones}
                    onChange={(nd) => setDrafts((m) => ({ ...m, [it.id]: nd }))}
                  />
                  <div className="ml-auto flex gap-1">
                    <Button
                      size="sm"
                      variant={dirty ? "default" : "ghost"}
                      disabled={!dirty}
                      onClick={() => run(() => api.updateItem(it.id, d), "已保存")}
                    >
                      <Save className="size-4" /> 保存
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => run(() => api.deleteItem(it.id), "已删除打铃项")}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              )
            })}
            {/* 新增行 */}
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2.5">
              <ItemEditor draft={newItem} ringtones={ringtones} onChange={setNewItem} />
              <Button
                size="sm"
                className="ml-auto"
                onClick={() =>
                  run(async () => {
                    await api.addItem(selected.id, newItem)
                    setNewItem(EMPTY_DRAFT)
                  }, "已添加打铃项")
                }
              >
                <Plus className="size-4" /> 添加
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="fade-up">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <CalendarClock className="size-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">还没有作息表，点击上方「新建作息表」开始。</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
