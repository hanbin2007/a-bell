const api = {
  async req(method, url, body) {
    const opt = { method, headers: {} };
    if (body instanceof FormData) opt.body = body;
    else if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    const r = await fetch(url, opt);
    if (!r.ok) {
      const e = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(e.detail);
    }
    return r.json();
  },
  get: (u) => api.req('GET', u),
  post: (u, b) => api.req('POST', u, b),
  put: (u, b) => api.req('PUT', u, b),
  del: (u) => api.req('DELETE', u),
};

function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = isError ? 'show error' : 'show';
  setTimeout(() => (el.className = ''), 3000);
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------- Tab switching ----------

const renderers = {
  dashboard: renderDashboard,
  schedules: renderSchedules,
  ringtones: renderRingtones,
  calendar: renderCalendar,
  device: renderDevice,
  logs: renderLogs,
};

async function switchTab(name) {
  document.querySelectorAll('#tabs button').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((s) =>
    s.classList.toggle('active', s.id === 'tab-' + name));
  try {
    await renderers[name]();
  } catch (err) {
    toast(err.message, true);
  }
}

document.querySelectorAll('#tabs button').forEach((b) =>
  b.addEventListener('click', () => switchTab(b.dataset.tab)));

// ---------- 仪表盘 ----------

let countdownTimer = null;
let dashboardGen = 0;

const KIND_TEXT = {
  normal: '正常打铃日',
  holiday: '节假日（不打铃）',
  workday: '调休上班日（打铃）',
};

function fmtCountdown(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function renderDashboard() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  const gen = ++dashboardGen;
  const st = await api.get('/api/status');
  if (gen !== dashboardGen) return;
  const el = document.getElementById('tab-dashboard');

  let nextHtml;
  if (st.next_bell) {
    nextHtml = `<p>下次打铃：<strong>${esc(st.next_bell.label)}</strong> ${esc(st.next_bell.time.replace('T', ' '))}（还有 <span id="countdown">${fmtCountdown(st.next_bell.seconds)}</span>）</p>`;
  } else {
    nextHtml = '<p>近两周没有待打的铃。</p>';
  }

  el.innerHTML = `
    <div class="card">
      <p>当前作息表：<strong>${st.active_schedule ? esc(st.active_schedule.name) : '（未设置）'}</strong></p>
      <p>今天：${esc(st.today.date)} · ${KIND_TEXT[st.today.kind] || esc(st.today.kind)}</p>
      ${nextHtml}
      ${st.last_fail ? `<p class="error">上次失败：${esc(st.last_fail.ts)} ${esc(st.last_fail.label)} — ${esc(st.last_fail.detail)}</p>` : ''}
    </div>
    <div class="card">
      <label><input type="checkbox" id="suspend-toggle" ${st.suspended ? 'checked' : ''}> 临时停铃</label>
      <button id="ring-now" class="primary">立即打铃</button>
    </div>`;

  if (st.next_bell) {
    let remain = st.next_bell.seconds;
    const timer = setInterval(() => {
      if (gen !== dashboardGen) { clearInterval(timer); return; }
      remain -= 1;
      if (remain <= 0) {
        clearInterval(timer);
        countdownTimer = null;
        renderDashboard().catch((e) => toast(e.message, true));
        return;
      }
      const cd = document.getElementById('countdown');
      if (cd) cd.textContent = fmtCountdown(remain);
    }, 1000);
    if (gen === dashboardGen) {
      countdownTimer = timer;
    } else {
      clearInterval(timer);
    }
  }

  document.getElementById('suspend-toggle').addEventListener('change', async (ev) => {
    try {
      await api.post('/api/suspend', { suspended: ev.target.checked });
      toast(ev.target.checked ? '已暂停打铃' : '已恢复打铃');
      renderDashboard().catch((e) => toast(e.message, true));
    } catch (err) { toast(err.message, true); }
  });

  document.getElementById('ring-now').addEventListener('click', async () => {
    try {
      await api.post('/api/ring', {});
      toast('已开始打铃');
    } catch (err) { toast(err.message, true); }
  });
}

// ---------- 作息表 ----------

let selectedScheduleId = null;
const WEEKDAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'];

function weekdayChecks(prefix, mask) {
  return WEEKDAY_NAMES.map((n, i) =>
    `<label class="wd"><input type="checkbox" class="${prefix}-wd" data-i="${i}" ${mask[i] === '1' ? 'checked' : ''}>${n}</label>`
  ).join('');
}

function ringtoneSelect(cls, ringtones, selectedId) {
  const opts = ['<option value="">（无）</option>'].concat(
    ringtones.map((r) =>
      `<option value="${r.id}" ${r.id === selectedId ? 'selected' : ''}>${esc(r.name)}</option>`));
  return `<select class="${cls}">${opts.join('')}</select>`;
}

function readItemRow(row) {
  const weekdays = Array.from(row.querySelectorAll('.it-wd'))
    .map((c) => (c.checked ? '1' : '0')).join('');
  const rid = row.querySelector('.it-ringtone').value;
  return {
    time: row.querySelector('.it-time').value,
    label: row.querySelector('.it-label').value,
    weekdays,
    ringtone_id: rid === '' ? null : Number(rid),
    enabled: row.querySelector('.it-enabled').checked,
  };
}

async function renderSchedules() {
  const [schedules, ringtones] = await Promise.all([
    api.get('/api/schedules'),
    api.get('/api/ringtones'),
  ]);
  const el = document.getElementById('tab-schedules');

  const active = schedules.find((s) => s.is_active);
  if (selectedScheduleId === null || !schedules.some((s) => s.id === selectedScheduleId)) {
    selectedScheduleId = active ? active.id : (schedules[0] ? schedules[0].id : null);
  }
  const sel = schedules.find((s) => s.id === selectedScheduleId);

  const listHtml = schedules.map((s) => `
    <li class="sched-row ${s.id === selectedScheduleId ? 'selected' : ''}">
      <span class="sched-name" data-id="${s.id}">${s.is_active ? '★ ' : ''}${esc(s.name)}</span>
      <span class="row-actions">
        <button class="sched-rename" data-id="${s.id}" data-name="${esc(s.name)}">改名</button>
        ${s.is_active ? '' : `<button class="sched-activate" data-id="${s.id}">激活</button>`}
        <button class="sched-del" data-id="${s.id}" data-name="${esc(s.name)}" ${s.is_active ? 'disabled' : ''}>删除</button>
      </span>
    </li>`).join('');

  let itemsHtml = '<p>暂无作息表，请先新建。</p>';
  if (sel) {
    const rows = sel.items.map((it) => `
      <tr class="item-row" data-id="${it.id}">
        <td><input type="time" class="it-time" value="${esc(it.time)}"></td>
        <td><input type="text" class="it-label" value="${esc(it.label)}"></td>
        <td class="wd-cell">${weekdayChecks('it', it.weekdays)}</td>
        <td>${ringtoneSelect('it-ringtone', ringtones, it.ringtone_id)}</td>
        <td><input type="checkbox" class="it-enabled" ${it.enabled ? 'checked' : ''}></td>
        <td>
          <button class="item-save">保存</button>
          <button class="item-del">删除</button>
        </td>
      </tr>`).join('');
    itemsHtml = `
      <h3>${esc(sel.name)} 的铃声项</h3>
      <table>
        <thead><tr><th>时间</th><th>名称</th><th>星期</th><th>铃声</th><th>启用</th><th>操作</th></tr></thead>
        <tbody>
          ${rows}
          <tr class="item-row" id="new-item-row">
            <td><input type="time" class="it-time"></td>
            <td><input type="text" class="it-label" placeholder="如：上课"></td>
            <td class="wd-cell">${weekdayChecks('it', '1111100')}</td>
            <td>${ringtoneSelect('it-ringtone', ringtones, null)}</td>
            <td><input type="checkbox" class="it-enabled" checked></td>
            <td><button id="item-add" class="primary">添加</button></td>
          </tr>
        </tbody>
      </table>`;
  }

  el.innerHTML = `
    <div class="card">
      <div class="bar"><h2>作息表</h2><button id="sched-new" class="primary">新建</button></div>
      <ul class="plain-list">${listHtml || '<li>（空）</li>'}</ul>
    </div>
    <div class="card">${itemsHtml}</div>`;

  const rerender = () => renderSchedules().catch((e) => toast(e.message, true));

  document.getElementById('sched-new').addEventListener('click', async () => {
    const name = prompt('新作息表名称：');
    if (!name) return;
    try {
      const r = await api.post('/api/schedules', { name });
      selectedScheduleId = r.id;
      toast('已新建作息表');
      rerender();
    } catch (err) { toast(err.message, true); }
  });

  el.querySelectorAll('.sched-name').forEach((s) =>
    s.addEventListener('click', () => {
      selectedScheduleId = Number(s.dataset.id);
      rerender();
    }));

  el.querySelectorAll('.sched-rename').forEach((b) =>
    b.addEventListener('click', async () => {
      const name = prompt('新名称：', b.dataset.name);
      if (!name) return;
      try {
        await api.put(`/api/schedules/${b.dataset.id}`, { name });
        toast('已改名');
        rerender();
      } catch (err) { toast(err.message, true); }
    }));

  el.querySelectorAll('.sched-activate').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api.post(`/api/schedules/${b.dataset.id}/activate`);
        toast('已激活');
        rerender();
      } catch (err) { toast(err.message, true); }
    }));

  el.querySelectorAll('.sched-del').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(`确定删除作息表「${b.dataset.name}」？`)) return;
      try {
        await api.del(`/api/schedules/${b.dataset.id}`);
        toast('已删除');
        rerender();
      } catch (err) { toast(err.message, true); }
    }));

  el.querySelectorAll('.item-save').forEach((b) =>
    b.addEventListener('click', async () => {
      const row = b.closest('tr');
      try {
        await api.put(`/api/items/${row.dataset.id}`, readItemRow(row));
        toast('已保存');
        rerender();
      } catch (err) { toast(err.message, true); }
    }));

  el.querySelectorAll('.item-del').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('确定删除该铃声项？')) return;
      const row = b.closest('tr');
      try {
        await api.del(`/api/items/${row.dataset.id}`);
        toast('已删除');
        rerender();
      } catch (err) { toast(err.message, true); }
    }));

  const addBtn = document.getElementById('item-add');
  if (addBtn) addBtn.addEventListener('click', async () => {
    const row = document.getElementById('new-item-row');
    const data = readItemRow(row);
    if (!data.time) { toast('请填写时间', true); return; }
    try {
      await api.post(`/api/schedules/${selectedScheduleId}/items`, data);
      toast('已添加');
      rerender();
    } catch (err) { toast(err.message, true); }
  });
}

// ---------- 铃声 ----------

async function renderRingtones() {
  const ringtones = await api.get('/api/ringtones');
  const el = document.getElementById('tab-ringtones');

  const rows = ringtones.map((r) => `
    <li class="ring-row">
      <div class="bar">
        <span><strong>${esc(r.name)}</strong> <small>${esc(r.created_at)}</small></span>
        <span class="row-actions">
          <button class="ring-rename" data-id="${r.id}" data-name="${esc(r.name)}">重命名</button>
          <button class="ring-del" data-id="${r.id}" data-name="${esc(r.name)}">删除</button>
        </span>
      </div>
      <audio controls src="/api/ringtones/${r.id}/file" preload="none"></audio>
    </li>`).join('');

  el.innerHTML = `
    <div class="card">
      <h2>上传铃声</h2>
      <form id="ring-upload">
        <input type="file" id="ring-file" accept=".mp3,.wav,.flac,.ogg" required>
        <input type="text" id="ring-name" placeholder="名称（可选）">
        <button type="submit" class="primary">上传</button>
      </form>
    </div>
    <div class="card">
      <h2>铃声列表</h2>
      <ul class="plain-list">${rows || '<li>（空）</li>'}</ul>
    </div>`;

  const rerender = () => renderRingtones().catch((e) => toast(e.message, true));

  document.getElementById('ring-upload').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const file = document.getElementById('ring-file').files[0];
    if (!file) { toast('请选择文件', true); return; }
    const fd = new FormData();
    fd.append('file', file);
    const name = document.getElementById('ring-name').value.trim();
    if (name) fd.append('name', name);
    try {
      await api.post('/api/ringtones', fd);
      toast('已上传');
      rerender();
    } catch (err) { toast(err.message, true); }
  });

  el.querySelectorAll('.ring-rename').forEach((b) =>
    b.addEventListener('click', async () => {
      const name = prompt('新名称：', b.dataset.name);
      if (!name) return;
      try {
        await api.put(`/api/ringtones/${b.dataset.id}`, { name });
        toast('已重命名');
        rerender();
      } catch (err) { toast(err.message, true); }
    }));

  el.querySelectorAll('.ring-del').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(`确定删除铃声「${b.dataset.name}」？`)) return;
      try {
        await api.del(`/api/ringtones/${b.dataset.id}`);
        toast('已删除');
        rerender();
      } catch (err) { toast(err.message, true); }
    }));
}

// ---------- 日历 ----------

const CAL_KIND_TEXT = { holiday: '节假日', workday: '调休上班' };

async function renderCalendar() {
  const entries = await api.get('/api/calendar');
  const el = document.getElementById('tab-calendar');

  const rows = entries.map((c) => `
    <tr>
      <td>${esc(c.date)}</td>
      <td>${CAL_KIND_TEXT[c.kind] || esc(c.kind)}</td>
      <td>${esc(c.note)}</td>
      <td><button class="cal-del" data-date="${esc(c.date)}">删除</button></td>
    </tr>`).join('');

  el.innerHTML = `
    <div class="card">
      <h2>添加特殊日期</h2>
      <form id="cal-add">
        <input type="date" id="cal-date" required>
        <select id="cal-kind">
          <option value="holiday">节假日</option>
          <option value="workday">调休上班</option>
        </select>
        <input type="text" id="cal-note" placeholder="备注">
        <button type="submit" class="primary">添加</button>
      </form>
    </div>
    <div class="card">
      <h2>特殊日期列表</h2>
      <table>
        <thead><tr><th>日期</th><th>类型</th><th>备注</th><th>操作</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4">（空）</td></tr>'}</tbody>
      </table>
    </div>`;

  const rerender = () => renderCalendar().catch((e) => toast(e.message, true));

  document.getElementById('cal-add').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const date = document.getElementById('cal-date').value;
    if (!date) { toast('请选择日期', true); return; }
    try {
      await api.post('/api/calendar', {
        date,
        kind: document.getElementById('cal-kind').value,
        note: document.getElementById('cal-note').value,
      });
      toast('已保存');
      rerender();
    } catch (err) { toast(err.message, true); }
  });

  el.querySelectorAll('.cal-del').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(`确定删除 ${b.dataset.date}？`)) return;
      try {
        await api.del(`/api/calendar/${b.dataset.date}`);
        toast('已删除');
        rerender();
      } catch (err) { toast(err.message, true); }
    }));
}

// ---------- 设备 ----------

async function renderDevice() {
  const st = await api.get('/api/settings');
  const el = document.getElementById('tab-device');

  el.innerHTML = `
    <div class="card">
      <h2>设备设置</h2>
      <div class="form-grid">
        <label>设备 ID <input type="text" id="dev-id" value="${esc(st.device_id)}"></label>
        <label>AirPlay 密码 <input type="password" id="dev-pwd" value="${esc(st.airplay_password)}"></label>
        <label>音量 <input type="number" id="dev-vol" min="0" max="100" value="${esc(st.volume)}"></label>
        <label>播放后端
          <select id="dev-backend">
            <option value="pyatv" ${st.backend === 'pyatv' ? 'selected' : ''}>HomePod</option>
            <option value="afplay" ${st.backend === 'afplay' ? 'selected' : ''}>本机调试</option>
          </select>
        </label>
      </div>
      <button id="dev-save" class="primary">保存</button>
      <button id="dev-test">测试播放</button>
    </div>
    <div class="card">
      <div class="bar"><h2>扫描设备</h2><button id="dev-scan">扫描设备</button></div>
      <ul class="plain-list" id="scan-result"></ul>
    </div>`;

  document.getElementById('dev-save').addEventListener('click', async () => {
    try {
      await api.put('/api/settings', {
        device_id: document.getElementById('dev-id').value,
        airplay_password: document.getElementById('dev-pwd').value,
        volume: document.getElementById('dev-vol').value.trim(),
        backend: document.getElementById('dev-backend').value,
      });
      toast('已保存设置');
    } catch (err) { toast(err.message, true); }
  });

  document.getElementById('dev-test').addEventListener('click', async () => {
    try {
      await api.post('/api/device/test');
      toast('已发送测试音');
    } catch (err) { toast(err.message, true); }
  });

  document.getElementById('dev-scan').addEventListener('click', async (ev) => {
    const btn = ev.target;
    btn.disabled = true;
    btn.textContent = '扫描中…';
    try {
      const devices = await api.get('/api/device/scan');
      const ul = document.getElementById('scan-result');
      ul.innerHTML = devices.length
        ? devices.map((d) => `
            <li class="bar">
              <span><strong>${esc(d.name)}</strong> <small>${esc(d.model)} · ${esc(d.address)} · ${esc(d.identifier)}</small></span>
              <button class="scan-pick" data-id="${esc(d.identifier)}">选用</button>
            </li>`).join('')
        : '<li>未发现设备。</li>';
      ul.querySelectorAll('.scan-pick').forEach((b) =>
        b.addEventListener('click', () => {
          document.getElementById('dev-id').value = b.dataset.id;
          toast('已填入设备 ID，记得点保存');
        }));
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = '扫描设备';
    }
  });
}

// ---------- 日志 ----------

async function renderLogs() {
  const logs = await api.get('/api/logs?limit=200');
  const el = document.getElementById('tab-logs');

  const rows = logs.map((l) => `
    <tr>
      <td>${esc(l.ts)}</td>
      <td>${esc(l.label)}</td>
      <td>${l.status === 'ok' ? '✅' : '❌'}</td>
      <td>${esc(l.detail)}</td>
    </tr>`).join('');

  el.innerHTML = `
    <div class="card">
      <div class="bar"><h2>打铃日志</h2><button id="logs-refresh">刷新</button></div>
      <table>
        <thead><tr><th>时间</th><th>名称</th><th>状态</th><th>详情</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4">（空）</td></tr>'}</tbody>
      </table>
    </div>`;

  document.getElementById('logs-refresh').addEventListener('click', () =>
    renderLogs().catch((e) => toast(e.message, true)));
}

// ---------- init ----------

switchTab('dashboard');
