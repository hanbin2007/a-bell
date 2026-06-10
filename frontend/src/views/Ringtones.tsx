import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, Music4, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { api, type Ringtone } from "@/api"
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
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export default function Ringtones() {
  const [list, setList] = useState<Ringtone[] | null>(null)
  const [name, setName] = useState("")
  const [uploading, setUploading] = useState(false)
  const [renaming, setRenaming] = useState<Ringtone | null>(null)
  const [renameTo, setRenameTo] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    api.ringtones().then(setList).catch((e) => toast.error((e as Error).message))
  }, [])
  useEffect(load, [load])

  const upload = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      toast.error("请先选择音频文件")
      return
    }
    const fd = new FormData()
    fd.append("file", file)
    if (name.trim()) fd.append("name", name.trim())
    setUploading(true)
    try {
      await api.uploadRingtone(fd)
      toast.success("上传成功")
      setName("")
      if (fileRef.current) fileRef.current.value = ""
      load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="fade-up">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="size-4 text-primary" /> 上传铃声
          </CardTitle>
          <CardDescription>支持 MP3 / WAV / FLAC / OGG，单个不超过 20MB（不支持 M4A）</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Input ref={fileRef} type="file" accept=".mp3,.wav,.flac,.ogg" className="w-72" />
          <Input
            placeholder="铃声名称（可选，默认取文件名）"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-64"
          />
          <Button onClick={upload} disabled={uploading}>
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            上传
          </Button>
        </CardContent>
      </Card>

      <Card className="fade-up" style={{ animationDelay: "60ms" }}>
        <CardHeader>
          <CardTitle className="text-base">铃声库</CardTitle>
        </CardHeader>
        <CardContent>
          {!list ? (
            <Skeleton className="h-24" />
          ) : list.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Music4 className="size-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">铃声库是空的，先上传一个铃声吧。</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead className="hidden md:table-cell">上传时间</TableHead>
                  <TableHead>试听</TableHead>
                  <TableHead className="w-28 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground tabular-nums md:table-cell">
                      {r.created_at}
                    </TableCell>
                    <TableCell>
                      <audio controls preload="none" src={api.ringtoneFileUrl(r.id)} className="h-8 max-w-56" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRenaming(r)
                          setRenameTo(r.name)
                        }}
                      >
                        改名
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost" className="text-destructive">
                            <Trash2 className="size-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>删除「{r.name}」？</AlertDialogTitle>
                            <AlertDialogDescription>
                              使用该铃声的打铃项将变为「无铃声」，到点会记失败日志。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={async () => {
                                try {
                                  await api.deleteRingtone(r.id)
                                  toast.success("已删除")
                                  load()
                                } catch (e) {
                                  toast.error((e as Error).message)
                                }
                              }}
                            >
                              删除
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={renaming !== null} onOpenChange={(v) => !v && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>重命名铃声</DialogTitle>
          </DialogHeader>
          <Input value={renameTo} onChange={(e) => setRenameTo(e.target.value)} />
          <DialogFooter>
            <Button
              disabled={!renameTo.trim()}
              onClick={async () => {
                if (!renaming) return
                try {
                  await api.renameRingtone(renaming.id, renameTo.trim())
                  toast.success("已重命名")
                  setRenaming(null)
                  load()
                } catch (e) {
                  toast.error((e as Error).message)
                }
              }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
