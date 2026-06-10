import { useCallback, useEffect, useState } from "react"
import { RefreshCw, ScrollText } from "lucide-react"
import { toast } from "sonner"
import { api, type RingLog } from "@/api"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export default function LogsView() {
  const [logs, setLogs] = useState<RingLog[] | null>(null)

  const load = useCallback(() => {
    api.logs(200).then(setLogs).catch((e) => toast.error((e as Error).message))
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  return (
    <Card className="fade-up">
      <CardHeader className="flex flex-row items-center space-y-0">
        <div>
          <CardTitle className="text-base">打铃日志</CardTitle>
          <CardDescription>保留最近 1000 条，每 30 秒自动刷新</CardDescription>
        </div>
        <Button variant="outline" size="sm" className="ml-auto" onClick={load}>
          <RefreshCw className="size-4" /> 刷新
        </Button>
      </CardHeader>
      <CardContent>
        {!logs ? (
          <Skeleton className="h-40" />
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <ScrollText className="size-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">还没有打铃记录。</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">时间</TableHead>
                <TableHead>名称</TableHead>
                <TableHead className="w-20">状态</TableHead>
                <TableHead>详情</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((l) => (
                <TableRow key={l.id} className={cn(l.status === "fail" && "bg-destructive/5")}>
                  <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                    {l.ts}
                  </TableCell>
                  <TableCell className="font-medium">{l.label}</TableCell>
                  <TableCell>
                    {l.status === "ok" ? (
                      <Badge variant="outline" className="border-ok/40 text-ok">
                        成功
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-destructive/40 text-destructive">
                        失败
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{l.detail}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
