import { useCallback, useEffect, useState } from "react"
import { CalendarDays, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { api, type CalendarOverride } from "@/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export default function CalendarView({ onChanged }: { onChanged: () => void }) {
  const [list, setList] = useState<CalendarOverride[] | null>(null)
  const [date, setDate] = useState("")
  const [kind, setKind] = useState<"holiday" | "workday">("holiday")
  const [note, setNote] = useState("")

  const load = useCallback(() => {
    api.calendar().then(setList).catch((e) => toast.error((e as Error).message))
  }, [])
  useEffect(load, [load])

  const add = async () => {
    try {
      await api.upsertCalendar({ date, kind, note: note.trim() })
      toast.success("已保存（同日期会覆盖）")
      setDate("")
      setNote("")
      load()
      onChanged()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const remove = async (d: string) => {
    try {
      await api.deleteCalendar(d)
      toast.success("已删除")
      load()
      onChanged()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="fade-up">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="size-4 text-primary" /> 添加特殊日期
          </CardTitle>
          <CardDescription>节假日整天跳过打铃；调休上班日（如周六补班）按工作日打铃</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-44 font-mono tabular-nums"
          />
          <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="holiday">节假日（跳过）</SelectItem>
              <SelectItem value="workday">调休上班（照常）</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="备注（可选，如：国庆）"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-56"
          />
          <Button onClick={add} disabled={!date}>
            <Plus className="size-4" /> 保存
          </Button>
        </CardContent>
      </Card>

      <Card className="fade-up" style={{ animationDelay: "60ms" }}>
        <CardHeader>
          <CardTitle className="text-base">特殊日期列表</CardTitle>
        </CardHeader>
        <CardContent>
          {!list ? (
            <Skeleton className="h-24" />
          ) : list.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              还没有特殊日期。法定节假日需要手动添加。
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日期</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead className="hidden md:table-cell">备注</TableHead>
                  <TableHead className="w-16 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((o) => (
                  <TableRow key={o.date}>
                    <TableCell className="font-mono tabular-nums">{o.date}</TableCell>
                    <TableCell>
                      {o.kind === "holiday" ? (
                        <Badge variant="outline" className="border-destructive/40 text-destructive">
                          节假日 · 跳过
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-primary/40 text-primary">
                          调休上班 · 照常
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {o.note}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => remove(o.date)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
