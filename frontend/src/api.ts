// a-bell REST API 类型与客户端（契约见 docs/superpowers/plans/2026-06-09-a-bell.md）

export interface Status {
  suspended: boolean
  active_schedule: { id: number; name: string } | null
  today: { date: string; kind: "normal" | "holiday" | "workday" }
  next_bell: { time: string; label: string; seconds: number } | null
  last_fail: { ts: string; label: string; detail: string } | null
}

export interface BellItem {
  id: number
  time: string
  label: string
  weekdays: string // 7 位 0/1 掩码，index 0 = 周一
  ringtone_id: number | null
  enabled: number | boolean
}

export interface Schedule {
  id: number
  name: string
  is_active: number
  items: BellItem[]
}

export interface Ringtone {
  id: number
  name: string
  filename: string
  created_at: string
}

export interface CalendarOverride {
  date: string
  kind: "holiday" | "workday"
  note: string
}

export interface Settings {
  device_id: string
  airplay_password: string
  volume: string
  backend: string
}

export interface Device {
  name: string
  identifier: string
  address: string
  model: string
}

export interface RingLog {
  id: number
  ts: string
  label: string
  status: "ok" | "fail"
  detail: string
}

async function parse(r: Response) {
  if (!r.ok) {
    let detail: unknown = r.statusText
    try {
      detail = (await r.json()).detail ?? detail
    } catch {
      /* 非 JSON 错误体 */
    }
    if (Array.isArray(detail)) {
      // pydantic 422：取首条校验信息
      const first = detail[0] as { msg?: string } | undefined
      detail = first?.msg ?? "请求参数无效"
    }
    throw new Error(String(detail))
  }
  return r.json()
}

function send(method: string, url: string, body?: unknown) {
  const init: RequestInit = { method }
  if (body instanceof FormData) {
    init.body = body
  } else if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" }
    init.body = JSON.stringify(body)
  }
  return fetch(url, init).then(parse)
}

export const api = {
  status: (): Promise<Status> => send("GET", "/api/status"),
  suspend: (suspended: boolean) => send("POST", "/api/suspend", { suspended }),
  ring: (ringtone_id?: number) =>
    send("POST", "/api/ring", ringtone_id === undefined ? {} : { ringtone_id }),

  schedules: (): Promise<Schedule[]> => send("GET", "/api/schedules"),
  createSchedule: (name: string): Promise<{ id: number }> => send("POST", "/api/schedules", { name }),
  renameSchedule: (id: number, name: string) => send("PUT", `/api/schedules/${id}`, { name }),
  deleteSchedule: (id: number) => send("DELETE", `/api/schedules/${id}`),
  activateSchedule: (id: number) => send("POST", `/api/schedules/${id}/activate`),
  addItem: (scheduleId: number, item: Omit<BellItem, "id">): Promise<{ id: number }> =>
    send("POST", `/api/schedules/${scheduleId}/items`, item),
  updateItem: (id: number, item: Omit<BellItem, "id">) => send("PUT", `/api/items/${id}`, item),
  deleteItem: (id: number) => send("DELETE", `/api/items/${id}`),

  ringtones: (): Promise<Ringtone[]> => send("GET", "/api/ringtones"),
  uploadRingtone: (fd: FormData): Promise<{ id: number }> => send("POST", "/api/ringtones", fd),
  renameRingtone: (id: number, name: string) => send("PUT", `/api/ringtones/${id}`, { name }),
  deleteRingtone: (id: number) => send("DELETE", `/api/ringtones/${id}`),
  ringtoneFileUrl: (id: number) => `/api/ringtones/${id}/file`,

  calendar: (): Promise<CalendarOverride[]> => send("GET", "/api/calendar"),
  upsertCalendar: (o: CalendarOverride) => send("POST", "/api/calendar", o),
  deleteCalendar: (date: string) => send("DELETE", `/api/calendar/${date}`),

  settings: (): Promise<Settings> => send("GET", "/api/settings"),
  saveSettings: (s: Partial<Settings>) => send("PUT", "/api/settings", s),
  scanDevices: (): Promise<Device[]> => send("GET", "/api/device/scan"),
  testPlay: () => send("POST", "/api/device/test"),

  logs: (limit = 200): Promise<RingLog[]> => send("GET", `/api/logs?limit=${limit}`),
}

export const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"] as const

/** 判断某打铃项在指定日期是否生效（与后端 engine.applies_on 同语义） */
export function appliesOn(item: BellItem, weekday: number, kind: Status["today"]["kind"]): boolean {
  if (!item.enabled) return false
  if (kind === "holiday") return false
  if (kind === "workday") return item.weekdays.slice(0, 5).includes("1")
  return item.weekdays[weekday] === "1"
}
