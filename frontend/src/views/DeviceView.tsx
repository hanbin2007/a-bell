import { useEffect, useState } from "react"
import { Loader2, Play, RadioTower, Save, Speaker } from "lucide-react"
import { toast } from "sonner"
import { api, type Device, type Settings } from "@/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

export default function DeviceView() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    api.settings().then(setSettings).catch((e) => toast.error((e as Error).message))
  }, [])

  const scan = async () => {
    setScanning(true)
    setDevices(null)
    try {
      setDevices(await api.scanDevices())
    } catch (e) {
      toast.error((e as Error).message)
      setDevices([])
    } finally {
      setScanning(false)
    }
  }

  const save = async () => {
    if (!settings) return
    setSaving(true)
    try {
      await api.saveSettings(settings)
      toast.success("设置已保存")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      await api.testPlay()
      toast.success("已发送测试音，结果见「日志」")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setTesting(false)
    }
  }

  if (!settings) return <Skeleton className="h-72" />

  const set = (patch: Partial<Settings>) => setSettings({ ...settings, ...patch })

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="fade-up">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Speaker className="size-4 text-primary" /> 播放设置
          </CardTitle>
          <CardDescription>铃声通过 AirPlay 推送到下方指定的 HomePod</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dev-id">设备标识（identifier）</Label>
            <Input
              id="dev-id"
              value={settings.device_id}
              onChange={(e) => set({ device_id: e.target.value })}
              placeholder="用右侧「扫描设备」选用后自动填入"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dev-pwd">AirPlay 密码（可选）</Label>
            <Input
              id="dev-pwd"
              type="password"
              value={settings.airplay_password}
              onChange={(e) => set({ airplay_password: e.target.value })}
              placeholder="家庭设置了「要求密码」时填写"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="dev-vol">音量（0-100，可选）</Label>
              <Input
                id="dev-vol"
                type="number"
                min={0}
                max={100}
                value={settings.volume}
                onChange={(e) => set({ volume: e.target.value })}
                placeholder="跟随设备"
              />
            </div>
            <div className="space-y-1.5">
              <Label>播放后端</Label>
              <Select value={settings.backend || "pyatv"} onValueChange={(v) => set({ backend: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pyatv">HomePod（AirPlay）</SelectItem>
                  <SelectItem value="afplay">本机扬声器（调试）</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              保存设置
            </Button>
            <Button variant="outline" onClick={test} disabled={testing}>
              {testing ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              测试播放
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="fade-up" style={{ animationDelay: "60ms" }}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <RadioTower className="size-4 text-primary" /> 扫描局域网设备
          </CardTitle>
          <CardDescription>HomePod 需通电并与本机在同一网络（扫描约 8 秒）</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="outline" onClick={scan} disabled={scanning}>
            {scanning ? (
              <>
                <Loader2 className="size-4 animate-spin" /> 扫描中…
              </>
            ) : (
              <>
                <RadioTower className="size-4" /> 开始扫描
              </>
            )}
          </Button>
          {devices && devices.length === 0 && (
            <p className="text-sm text-muted-foreground">
              没有发现 AirPlay 设备。请确认 HomePod 已通电、与本机同一网络。
            </p>
          )}
          {devices?.map((d) => {
            const chosen = settings.device_id === d.identifier
            return (
              <div
                key={d.identifier}
                className={cn(
                  "flex items-center gap-3 rounded-md border px-3 py-2.5",
                  chosen && "border-primary/50 bg-accent",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{d.name}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {d.model} · {d.address}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={chosen ? "default" : "outline"}
                  onClick={() => set({ device_id: d.identifier })}
                >
                  {chosen ? "已选用" : "选用"}
                </Button>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
