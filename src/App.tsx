import { useEffect, useState } from 'react'
import { Archive, ArrowRight, CalendarDays, Check, CheckCircle2, ChevronDown, Circle, Clock3, Copy, Download, Edit3, Home, Inbox, MapPin, Menu, NotebookPen, Plus, Search, Settings as SettingsIcon, Sparkles, Trash2, Upload, X } from 'lucide-react'
import type { CalendarEvent, DiaryEntry, GptInboxItem, Mood, MoodLog, Page, Progress, Settings, Status, Task } from './types'
import { dayPlan, defaultSettings, formatDeadline, formatEventTime, inboxItemToEvent, inboxItemToTask, localDate, makeDiaryComment, moodGuidance, moodInfo, moodOptions, parseGptImportHash, rankedTasks, sampleTasks, toLocalDateTimeValue, useStoredState } from './lib'

const nav: { id: Page; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'ホーム', icon: Home }, { id: 'tasks', label: 'タスク', icon: CheckCircle2 },
  { id: 'calendar', label: 'カレンダー', icon: CalendarDays },
  { id: 'diary', label: '日記・気分', icon: NotebookPen }, { id: 'settings', label: '設定', icon: SettingsIcon },
]

const blankTask = (): Task => ({ id: crypto.randomUUID(), title: '', deadline: toLocalDateTimeValue(new Date(Date.now() + 86400000)), category: '課題', priority: '中', progress: 0, estimatedMinutes: 60, status: '未着手', memo: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
const blankEvent = (): CalendarEvent => {
  const start = new Date(Date.now() + 86400000)
  start.setHours(10, 0, 0, 0)
  const end = new Date(start.getTime() + 60 * 60 * 1000)
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), title: '', startAt: toLocalDateTimeValue(start), endAt: toLocalDateTimeValue(end), location: '', memo: '', createdAt: now, updatedAt: now }
}

const eventDurationMinutes = (event: Pick<CalendarEvent, 'startAt' | 'endAt'>) => {
  const start = new Date(event.startAt).getTime(), end = new Date(event.endAt).getTime()
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0
  return Math.min(24 * 60, Math.round((end - start) / 60000))
}

type AppBackup = {
  version?: number
  exportedAt?: string
  tasks?: Task[]
  events?: CalendarEvent[]
  moodLogs?: MoodLog[]
  diaries?: DiaryEntry[]
  gptInbox?: GptInboxItem[]
  settings?: Settings
}

export default function App() {
  const [page, setPage] = useState<Page>('home')
  const [tasks, setTasks] = useStoredState<Task[]>('lady.tasks', sampleTasks)
  const [events, setEvents] = useStoredState<CalendarEvent[]>('lady.events', [])
  const [moodLogs, setMoodLogs] = useStoredState<MoodLog[]>('lady.moods', [])
  const [diaries, setDiaries] = useStoredState<DiaryEntry[]>('lady.diaries', [])
  const [gptInbox, setGptInbox] = useStoredState<GptInboxItem[]>('lady.gptInbox', [])
  const [settings, setSettings] = useStoredState<Settings>('lady.settings', defaultSettings)
  const [editing, setEditing] = useState<Task | null>(null)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [importNotice, setImportNotice] = useState('')
  const [menu, setMenu] = useState(false)
  const changePage = (p: Page) => { setPage(p); setMenu(false) }
  const saveTask = (task: Task) => { setTasks(prev => prev.some(t => t.id === task.id) ? prev.map(t => t.id === task.id ? { ...task, updatedAt: new Date().toISOString() } : t) : [...prev, task]); setEditing(null) }
  const saveEvent = (event: CalendarEvent) => { setEvents(prev => prev.some(item => item.id === event.id) ? prev.map(item => item.id === event.id ? { ...event, updatedAt: new Date().toISOString() } : item) : [...prev, event]); setEditingEvent(null) }
  const complete = (id: string) => setTasks(prev => prev.map(t => t.id === id ? { ...t, progress: t.status === '完了' ? 0 : 100, status: t.status === '完了' ? '未着手' : '完了', updatedAt: new Date().toISOString() } : t))
  const saveMood = (mood: Mood, memo: string, date = localDate()) => setMoodLogs(prev => {
    const existing = prev.find(log => log.date === date), now = new Date().toISOString()
    return existing ? prev.map(log => log.date === date ? { ...log, mood, memo, updatedAt: now } : log) : [{ id: crypto.randomUUID(), date, mood, memo, createdAt: now, updatedAt: now }, ...prev]
  })
  const saveDiary = (entry: DiaryEntry) => setDiaries(prev => prev.some(item => item.date === entry.date) ? prev.map(item => item.date === entry.date ? entry : item) : [entry, ...prev])
  const acceptInboxItem = (item: GptInboxItem) => {
    if (item.type === 'event') setEvents(prev => [...prev, inboxItemToEvent(item)])
    else setTasks(prev => [...prev, inboxItemToTask(item)])
    setGptInbox(prev => prev.filter(candidate => candidate.id !== item.id))
    setImportNotice('')
  }
  const dismissInboxItem = (id: string) => { setGptInbox(prev => prev.filter(item => item.id !== id)); setImportNotice('') }
  const backup: AppBackup = { version: 1, tasks, events, moodLogs, diaries, gptInbox, settings }
  const restoreBackup = (data: AppBackup) => {
    if (!data || typeof data !== 'object') throw new Error('バックアップの形式が読み取れません。')
    if (!confirm('バックアップを読み込みます。現在この端末にあるデータは上書きされます。よろしいですか？')) return false
    setTasks(Array.isArray(data.tasks) ? data.tasks : [])
    setEvents(Array.isArray(data.events) ? data.events : [])
    setMoodLogs(Array.isArray(data.moodLogs) ? data.moodLogs : [])
    setDiaries(Array.isArray(data.diaries) ? data.diaries : [])
    setGptInbox(Array.isArray(data.gptInbox) ? data.gptInbox : [])
    setSettings({ ...defaultSettings, ...(data.settings && typeof data.settings === 'object' ? data.settings : {}) })
    return true
  }

  useEffect(() => {
    const incoming = parseGptImportHash(window.location.hash)
    if (!incoming.length) return
    setGptInbox(prev => {
      const key = (item: GptInboxItem) => item.type === 'event' ? `${item.type}:${item.title}:${item.startAt}:${item.endAt}:${item.sourceText}` : `${item.type}:${item.title}:${item.deadline}:${item.sourceText}`
      const seen = new Set(prev.map(key))
      return [...incoming.filter(item => !seen.has(key(item))), ...prev]
    })
    setImportNotice(`${incoming.length}件の候補をGPT受信箱に入れました。内容を確認してから追加できます。`)
    history.replaceState(null, '', `${location.pathname}${location.search}`)
  }, [setGptInbox])

  return <div className="app-shell">
    <aside className={`sidebar ${menu ? 'open' : ''}`}>
      <div className="brand"><div className="crest">L</div><div><strong>Lady's Butler</strong><span>Personal assistant</span></div><button className="icon-button mobile-close" onClick={() => setMenu(false)}><X size={20}/></button></div>
      <nav>{nav.map(item => <button key={item.id} title={item.label} data-page={item.id} className={page === item.id ? 'active' : ''} onClick={() => changePage(item.id)}><item.icon size={19}/><span>{item.label}</span>{item.id === 'tasks' && <em>{tasks.filter(t => t.status !== '完了').length}</em>}{item.id === 'calendar' && events.filter(event => localDate(new Date(event.startAt)) === localDate()).length > 0 && <em>{events.filter(event => localDate(new Date(event.startAt)) === localDate()).length}</em>}</button>)}</nav>
      <div className="sidebar-quote"><Sparkles size={16}/><p>完璧でなくて構いません。<br/>まず提出できる形に。</p></div>
      <div className="profile-mini"><div className="avatar">L</div><div><strong>{settings.name || 'レディ'}</strong><span>本日もお供します</span></div></div>
    </aside>
    {menu && <div className="scrim" onClick={() => setMenu(false)}/>} 
    <main>
      <header className="topbar"><button className="icon-button menu-button" onClick={() => setMenu(true)}><Menu/></button><div className="breadcrumbs"><span>Lady's Butler</span><i>/</i><b>{nav.find(n => n.id === page)?.label}</b></div><button className="quick-add" onClick={() => page === 'calendar' ? setEditingEvent(blankEvent()) : setEditing(blankTask())}><Plus size={17}/>{page === 'calendar' ? '予定を追加' : 'タスクを追加'}</button></header>
      <div className="page-wrap">
        {page === 'home' && <HomePage tasks={tasks} events={events} moodLogs={moodLogs} gptInbox={gptInbox} importNotice={importNotice} go={changePage} complete={complete} acceptInboxItem={acceptInboxItem} dismissInboxItem={dismissInboxItem}/>} 
        {page === 'tasks' && <TasksPage tasks={tasks} edit={setEditing} remove={id => setTasks(p => p.filter(t => t.id !== id))} complete={complete}/>} 
        {page === 'calendar' && <CalendarPage events={events} add={() => setEditingEvent(blankEvent())} edit={setEditingEvent} remove={id => setEvents(prev => prev.filter(event => event.id !== id))}/>} 
        {page === 'diary' && <DiaryPage moodLogs={moodLogs} diaries={diaries} saveMood={saveMood} saveDiary={saveDiary}/>} 
        {page === 'settings' && <SettingsPage settings={settings} setSettings={setSettings} backup={backup} restore={restoreBackup} clear={() => { localStorage.clear(); location.reload() }}/>} 
      </div>
    </main>
    <nav className="mobile-tabbar" aria-label="スマートフォン用メニュー">{nav.map(item => <button key={item.id} data-page={item.id} className={page === item.id ? 'active' : ''} onClick={() => changePage(item.id)}><item.icon size={19}/><span>{item.label}</span>{item.id === 'tasks' && tasks.filter(t => t.status !== '完了').length > 0 && <em>{tasks.filter(t => t.status !== '完了').length}</em>}{item.id === 'calendar' && events.filter(event => localDate(new Date(event.startAt)) === localDate()).length > 0 && <em>{events.filter(event => localDate(new Date(event.startAt)) === localDate()).length}</em>}</button>)}</nav>
    {editing && <TaskModal task={editing} save={saveTask} close={() => setEditing(null)}/>} 
    {editingEvent && <EventModal event={editingEvent} save={saveEvent} close={() => setEditingEvent(null)}/>} 
  </div>
}

function PageHeading({ eyebrow, title, children, action }: { eyebrow?: string; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <span>{eyebrow}</span>}<h1>{title}</h1>{children && <p>{children}</p>}</div>{action}</div>
}

function HomePage({ tasks, events, moodLogs, gptInbox, importNotice, go, complete, acceptInboxItem, dismissInboxItem }: { tasks: Task[]; events: CalendarEvent[]; moodLogs: MoodLog[]; gptInbox: GptInboxItem[]; importNotice: string; go: (p: Page) => void; complete: (id: string) => void; acceptInboxItem: (item: GptInboxItem) => void; dismissInboxItem: (id: string) => void }) {
  const todayMood = moodLogs.find(log => log.date === localDate())?.mood
  const basePlan = dayPlan(tasks, todayMood), incomplete = tasks.filter(t => t.status !== '完了')
  const todayEvents = [...events].filter(event => localDate(new Date(event.startAt)) === localDate()).sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt))
  const upcomingEvents = [...events].filter(event => new Date(event.endAt).getTime() >= Date.now() - 60 * 60 * 1000).sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt))
  const todayEventMinutes = todayEvents.reduce((sum, event) => sum + eventDurationMinutes(event), 0)
  const scheduleLoad = todayEventMinutes >= 240 || todayEvents.length >= 3 ? 'heavy' : todayEventMinutes >= 120 || todayEvents.length >= 2 ? 'medium' : 'light'
  const taskLimit = basePlan.today.length === 0 ? 0 : scheduleLoad === 'heavy' ? (todayMood === 'very_good' || todayMood === 'good' ? 2 : 1) : scheduleLoad === 'medium' ? Math.max(1, basePlan.today.length - 1) : basePlan.today.length
  const plan = { ...basePlan, today: basePlan.today.slice(0, taskLimit), extra: [...basePlan.today.slice(taskLimit), ...basePlan.extra] }
  const deferredBySchedule = Math.max(0, basePlan.today.length - plan.today.length)
  const workMinutes = plan.today.reduce((n,t) => n + Math.round(t.estimatedMinutes * (100-t.progress)/100), 0)
  const nextEvent = todayEvents.find(event => new Date(event.endAt).getTime() >= Date.now() - 60 * 60 * 1000) ?? upcomingEvents[0]
  const moodLabel = todayMood ? `${moodInfo(todayMood)?.emoji ?? ''} ${moodInfo(todayMood)?.label ?? ''}` : '未記録'
  const loadLabel = scheduleLoad === 'heavy' ? '詰め込み禁止' : scheduleLoad === 'medium' ? '軽め運転' : '余白あり'
  const loadAdvice = scheduleLoad === 'heavy' ? '今日は予定の密度が高めです。タスクは最優先だけに絞り、予定の前後へ作業を詰め込まないでください。' : scheduleLoad === 'medium' ? '今日は予定も作業もある日です。タスクは少し減らし、移動や休憩の余白を残しましょう。' : '今日は予定の圧迫が少なめです。最優先を一つ決めて、静かに進めましょう。'
  const commandTitle = plan.top ? `まずは「${plan.top.title}」を小さく進めましょう。` : nextEvent ? `次の予定「${nextEvent.title}」に合わせて余白を残しましょう。` : '今日は余白を守りながら整えましょう。'
  const commandBody = nextEvent ? `次の予定は${formatEventTime(nextEvent).label}、${formatEventTime(nextEvent).date} ${formatEventTime(nextEvent).time}です。${loadAdvice}` : loadAdvice
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const weekEnd = new Date(todayStart); weekEnd.setDate(weekEnd.getDate() + 7)
  const weekTasks = rankedTasks(tasks).filter(task => {
    const time = new Date(task.deadline).getTime()
    return !Number.isNaN(time) && time <= weekEnd.getTime()
  }).slice(0, 5)
  const weekEvents = [...events].filter(event => {
    const start = new Date(event.startAt).getTime(), end = new Date(event.endAt).getTime()
    return !Number.isNaN(start) && !Number.isNaN(end) && end >= todayStart.getTime() && start <= weekEnd.getTime()
  }).sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt)).slice(0, 5)
  const lowMoodDays = moodLogs.filter(log => {
    const date = new Date(`${log.date}T00:00:00`).getTime()
    return !Number.isNaN(date) && date >= todayStart.getTime() - 6 * 86400000 && (moodInfo(log.mood)?.score ?? 3) <= 2
  }).length
  const weekMinutes = weekTasks.reduce((sum, task) => sum + Math.round(task.estimatedMinutes * (100 - task.progress) / 100), 0)
  const urgentWeekTasks = weekTasks.filter(task => formatDeadline(task.deadline).urgent).length
  const weekMode = lowMoodDays >= 2 ? '回復を守る週' : urgentWeekTasks >= 2 ? '締切処理の週' : weekEvents.length >= 3 ? '予定に合わせる週' : '前倒しできる週'
  const weekAdvice = lowMoodDays >= 2 ? 'ここ数日は気分が低めです。今週は増やすより、締切と休息の両方を守る設計にしましょう。' : urgentWeekTasks >= 2 ? '近い締切が重なっています。大きく進めるより、提出ラインを先に作るのが安全です。' : weekEvents.length >= 3 ? '予定がやや多めです。空いている日にタスクを寄せ、予定のある日は軽くしておきましょう。' : '今週は少し前倒しできます。余力がある日に、重い課題の最初の一手だけ置いておきましょう。'
  const date = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())
  const guidance = moodGuidance(todayMood)
  return <>
    <PageHeading eyebrow={date} title="お帰りなさいませ、レディ。">本日も、やるべきことを静かに片づけてまいりましょう。</PageHeading>
    <section className="butler-callout"><div className="butler-mark"><Sparkles/></div><div><span>THE BUTLER'S NOTE</span><h2>{plan.top ? `本日の最優先は「${plan.top.title}」です。` : '本日の予定はすべて片づいております。'}</h2><p>{todayMood ? guidance : plan.top ? `完璧を目指す必要はありません。まず10分で「${plan.top.category === '課題' ? '資料を開き、見出しを3つ作る' : '必要なものを1つ開く'}」ところから始めましょう。` : '少し休むか、明日の準備をひとつだけしておきましょう。'}</p></div></section>
    {(importNotice || gptInbox.length > 0) && <section className="card gpt-inbox-card"><div className="section-title"><div><span>GPT INBOX</span><h2>GPTから届いた候補</h2></div><small>{gptInbox.length}件</small></div>{importNotice && <p className="inbox-notice">{importNotice}</p>}{gptInbox.length ? <div className="inbox-list">{gptInbox.map(item => {
      const eventTime = item.type === 'event' ? formatEventTime(item) : null
      return <article key={item.id}><div className="inbox-icon"><Inbox size={17}/></div><div><strong>{item.title}</strong>{item.type === 'event' ? <span>予定 ・ {eventTime?.label} {eventTime?.date} {eventTime?.time}{item.location ? ` ・ ${item.location}` : ''}</span> : <span>{item.category} ・ {formatDeadline(item.deadline).label} {formatDeadline(item.deadline).date} ・ 優先度{item.priority}</span>}{item.memo && <p>{item.memo}</p>}</div><div className="inbox-actions"><button className="primary" onClick={() => acceptInboxItem(item)}><Plus size={14}/>{item.type === 'event' ? '予定に追加' : 'タスクに追加'}</button><button onClick={() => dismissInboxItem(item.id)}>見送る</button></div></article>
    })}</div> : <p className="inbox-empty">候補はすべて処理済みです。</p>}</section>}
    <section className="card command-card"><div className="section-title"><div><span>TODAY COMMAND</span><h2>今日の司令塔</h2></div><button className="text-button" onClick={() => go('calendar')}>予定を見る <ArrowRight size={15}/></button></div><div className="command-grid"><div className="command-summary"><span>BUTLER'S PLAN</span><h2>{commandTitle}</h2><p>{commandBody}</p><div className="command-pills"><b>気分 {moodLabel}</b><b>作業目安 {workMinutes}分</b><b>今日の予定 {todayEvents.length}件</b><b className={`load-${scheduleLoad}`}>予定負荷 {loadLabel}</b></div></div><div className="command-lanes"><div className="command-lane"><div><span>SCHEDULE</span><strong>今日の予定</strong></div>{todayEvents.length ? todayEvents.slice(0, 4).map(event => <CommandEvent key={event.id} event={event}/>) : <p className="command-empty">今日の予定はまだありません。移動や休憩を入れる余白として使えます。</p>}</div><div className="command-lane"><div><span>TASKS</span><strong>今日の一手</strong></div>{plan.today.length ? <>{plan.today.slice(0, 4).map((task, i) => <CommandTask key={task.id} task={task} index={i}/>)}{deferredBySchedule > 0 && <p className="command-note">予定量に合わせて、{deferredBySchedule}件は明日以降候補へ回しました。</p>}</> : <p className="command-empty">急ぎのタスクはありません。明日の準備を一つだけ。</p>}</div></div></div></section>
    <WeekPlanCard mode={weekMode} advice={weekAdvice} tasks={weekTasks} events={weekEvents} minutes={weekMinutes} lowMoodDays={lowMoodDays} go={go}/>
    <div className="stats-row"><Stat icon={<CheckCircle2/>} label="未完了タスク" value={`${incomplete.length}`} suffix="件"/><Stat icon={<Clock3/>} label="今日の予定" value={`${todayEvents.length}`} suffix="件"/><Stat icon={<CalendarDays/>} label="締切間近" value={`${incomplete.filter(t => formatDeadline(t.deadline).urgent).length}`} suffix="件" danger/></div>
    <div className="home-grid">
      <section className="card today-card"><div className="section-title"><div><span>TODAY'S FOCUS</span><h2>今日やること</h2></div><button className="text-button" onClick={() => go('tasks')}>すべて見る <ArrowRight size={15}/></button></div>
        <div className="task-stack">{plan.today.length ? plan.today.map((task, i) => <TaskRow key={task.id} task={task} rank={i + 1} complete={complete}/>) : <Empty text="本日のタスクはありません"/>}</div>
        {plan.top && <div className="first-ten"><div><Clock3 size={18}/><strong>最初の10分</strong></div><p>{plan.top.category === '課題' ? '資料を開き、タイトルと見出しを3つだけ書く。' : `「${plan.top.title}」に必要なものを1つ開く。`}</p></div>}
      </section>
      <section className="card deadline-card"><div className="section-title"><div><span>UPCOMING</span><h2>締切が近いもの</h2></div></div>{rankedTasks(tasks).slice(0,4).map(t => { const d = formatDeadline(t.deadline); return <div className="deadline-row" key={t.id}><div className={`date-tile ${d.urgent ? 'urgent' : ''}`}><b>{new Date(t.deadline).getDate()}</b><span>{new Intl.DateTimeFormat('en', { month: 'short' }).format(new Date(t.deadline)).toUpperCase()}</span></div><div><strong>{t.title}</strong><span>{t.category} ・ {d.date}</span></div><div className={`badge priority-${t.priority}`}>{t.priority}</div></div>})}</section>
    </div>
  </>
}

function Stat({ icon, label, value, suffix, danger }: { icon: React.ReactNode; label: string; value: string; suffix: string; danger?: boolean }) { return <div className={`stat ${danger ? 'danger' : ''}`}><div>{icon}</div><span>{label}</span><strong>{value}<small>{suffix}</small></strong></div> }

function CommandEvent({ event }: { event: CalendarEvent }) {
  const info = formatEventTime(event)
  return <article className={`command-item command-event ${info.today ? 'today' : ''}`}>
    <div className="command-time"><Clock3 size={14}/><span>{info.time}</span></div>
    <div className="command-main"><strong>{event.title}</strong><p>{info.label} {info.date}{event.location ? ` ・ ${event.location}` : ''}</p></div>
  </article>
}

function CommandTask({ task, index }: { task: Task; index: number }) {
  const deadline = formatDeadline(task.deadline, true)
  return <article className="command-item command-task">
    <div className="command-time"><CheckCircle2 size={14}/><span>{String(index + 1).padStart(2, '0')}</span></div>
    <div className="command-main"><strong>{task.title}</strong><p>{deadline.label} {deadline.date} ・ 優先度{task.priority} ・ {Math.max(5, Math.round(task.estimatedMinutes * (100 - task.progress) / 100))}分目安</p></div>
  </article>
}

function WeekPlanCard({ mode, advice, tasks, events, minutes, lowMoodDays, go }: { mode: string; advice: string; tasks: Task[]; events: CalendarEvent[]; minutes: number; lowMoodDays: number; go: (p: Page) => void }) {
  const topTask = tasks[0], nextEvent = events[0]
  return <section className="card week-card">
    <div className="section-title"><div><span>WEEK STRATEGY</span><h2>今週の作戦</h2></div><button className="text-button" onClick={() => go('tasks')}>タスクを見る <ArrowRight size={15}/></button></div>
    <div className="week-grid">
      <div className="week-brief"><span>MODE</span><h3>{mode}</h3><p>{advice}</p><div className="week-metrics"><b>7日以内のタスク {tasks.length}件</b><b>予定 {events.length}件</b><b>作業目安 {minutes}分</b>{lowMoodDays > 0 && <b>低め気分 {lowMoodDays}日</b>}</div></div>
      <div className="week-next">
        <div><span>NEXT MOVE</span><strong>{topTask ? `まず「${topTask.title}」` : nextEvent ? `次は「${nextEvent.title}」` : '今週は整える余白あり'}</strong></div>
        <p>{topTask ? `${formatDeadline(topTask.deadline).label} ${formatDeadline(topTask.deadline).date}。完成ではなく、提出ラインを作るところからで十分です。` : nextEvent ? `${formatEventTime(nextEvent).label} ${formatEventTime(nextEvent).date} ${formatEventTime(nextEvent).time}。準備を一つだけ先に置きましょう。` : '急ぎの締切はありません。日記か予定の整理を少しだけしておきましょう。'}</p>
      </div>
    </div>
  </section>
}

function TaskRow({ task, rank, complete }: { task: Task; rank: number; complete: (id: string) => void }) {
  const d = formatDeadline(task.deadline)
  return <div className="task-row"><button className="check" onClick={() => complete(task.id)}><Circle size={22}/></button><div className="rank">0{rank}</div><div className="task-main"><strong>{task.title}</strong><div><span className="category-dot">{task.category}</span><span className={d.urgent ? 'urgent-text' : ''}><Clock3 size={13}/>{d.label} {d.date}</span></div></div><div className="progress-box"><span>{task.progress}%</span><div><i style={{ width: `${task.progress}%` }}/></div></div><span className={`badge priority-${task.priority}`}>優先度 {task.priority}</span></div>
}

function TasksPage({ tasks, edit, remove, complete }: { tasks: Task[]; edit: (t: Task) => void; remove: (id: string) => void; complete: (id: string) => void }) {
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('未完了'), [sort, setSort] = useState('締切が近い順')
  let shown = tasks.filter(t => t.title.includes(query) && (filter === 'すべて' || filter === '未完了' ? filter === 'すべて' || t.status !== '完了' : t.status === filter))
  shown = [...shown].sort(sort === '優先度順' ? (a,b) => ({高:3,中:2,低:1}[b.priority]-{高:3,中:2,低:1}[a.priority]) : (a,b) => +new Date(a.deadline)-+new Date(b.deadline))
  return <><PageHeading eyebrow="TASKS" title="タスク"><>{tasks.filter(t => t.status !== '完了').length}件の未完了タスクがあります。今やるものだけを見ましょう。</></PageHeading>
    <div className="toolbar"><label className="search"><Search size={18}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="タスクを検索"/></label><div className="segmented">{['未完了','すべて','進行中','完了'].map(v => <button className={filter === v ? 'active' : ''} onClick={() => setFilter(v)} key={v}>{v}</button>)}</div><label className="select-wrap"><select value={sort} onChange={e => setSort(e.target.value)}><option>締切が近い順</option><option>優先度順</option></select><ChevronDown size={15}/></label></div>
    <section className="card task-table"><div className="table-head"><span>タスク</span><span>締切</span><span>進捗</span><span>優先度</span><span>状態</span><span></span></div>{shown.map(t => <div className="table-row" key={t.id}><div className="task-title-cell"><button className={`check ${t.status === '完了' ? 'done' : ''}`} onClick={() => complete(t.id)}>{t.status === '完了' ? <Check size={16}/> : <Circle size={21}/>}</button><div><strong>{t.title}</strong><span>{t.category}{t.memo ? ` ・ ${t.memo}` : ''}</span></div></div><div><b className={formatDeadline(t.deadline).urgent ? 'urgent-text' : ''}>{formatDeadline(t.deadline).label}</b><span>{formatDeadline(t.deadline).date}</span></div><div className="inline-progress"><span>{t.progress}%</span><div><i style={{width:`${t.progress}%`}}/></div></div><div><span className={`badge priority-${t.priority}`}>{t.priority}</span></div><div><span className={`status status-${t.status}`}>{t.status}</span></div><div className="row-actions"><button onClick={() => edit(t)} title="編集"><Edit3 size={16}/></button><button onClick={() => remove(t.id)} title="削除"><Trash2 size={16}/></button></div></div>)}{!shown.length && <Empty text="条件に合うタスクはありません"/>}</section>
  </>
}

function CalendarPage({ events, add, edit, remove }: { events: CalendarEvent[]; add: () => void; edit: (event: CalendarEvent) => void; remove: (id: string) => void }) {
  const sorted = [...events].sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt))
  const upcoming = sorted.filter(event => new Date(event.endAt).getTime() >= Date.now() - 60 * 60 * 1000)
  const past = sorted.filter(event => new Date(event.endAt).getTime() < Date.now() - 60 * 60 * 1000).reverse()
  const todayCount = events.filter(event => localDate(new Date(event.startAt)) === localDate()).length
  const nextEvent = upcoming[0]
  return <>
    <PageHeading eyebrow="CALENDAR" title="カレンダー" action={<button className="primary" onClick={add}><Plus size={16}/>予定を追加</button>}>授業、バイト、面談、遊びの約束。タスクではない「時間の決まった予定」を置く場所です。</PageHeading>
    <section className="calendar-hero card">
      <div className="calendar-hero-main"><div className="calendar-orb"><CalendarDays/></div><div><span>SMART SCHEDULE</span><h2>{nextEvent ? `次の予定は「${nextEvent.title}」です。` : 'まだ予定は入っていません。'}</h2><p>{nextEvent ? `${formatEventTime(nextEvent).label}、${formatEventTime(nextEvent).date} ${formatEventTime(nextEvent).time}。必要な準備だけ、先に一つ置いておきましょう。` : 'GPTで「明日14時に美容院」などと話すと、予定候補としてここへ送れるようになります。'}</p></div></div>
      <div className="calendar-hero-stats"><div><strong>{todayCount}</strong><span>今日の予定</span></div><div><strong>{upcoming.length}</strong><span>今後の予定</span></div></div>
    </section>
    <div className="calendar-layout">
      <section className="card calendar-list-card"><div className="section-title"><div><span>AGENDA</span><h2>これからの予定</h2></div><small>{upcoming.length}件</small></div>{upcoming.length ? <div className="event-list">{upcoming.map(event => <EventRow key={event.id} event={event} edit={edit} remove={remove}/>)}</div> : <Empty text="これからの予定はありません"/>}</section>
      <section className="card calendar-side-card"><div className="section-title"><div><span>GPT FLOW</span><h2>自然文から追加</h2></div></div><div className="calendar-guide"><p>あなたのGPTに、こんなふうに話すだけで大丈夫です。</p><ul><li>「明日15時から美容院なんだよね」</li><li>「金曜の18時にバイト」</li><li>「7月3日13時からゼミ面談、研究室」</li></ul><p>GPTが日時・場所・メモを読み取り、このアプリの受信箱に「予定候補」として送ります。最後にあなたが確認して追加します。</p></div></section>
      {past.length > 0 && <section className="card calendar-list-card calendar-past"><div className="section-title"><div><span>PAST</span><h2>過去の予定</h2></div><small>{past.length}件</small></div><div className="event-list">{past.slice(0, 8).map(event => <EventRow key={event.id} event={event} edit={edit} remove={remove}/>)}</div></section>}
    </div>
  </>
}

function EventRow({ event, edit, remove }: { event: CalendarEvent; edit: (event: CalendarEvent) => void; remove: (id: string) => void }) {
  const info = formatEventTime(event)
  const date = new Date(event.startAt)
  return <article className={`event-row ${info.today ? 'today' : ''} ${info.past ? 'past' : ''}`}>
    <div className="event-date-tile"><b>{Number.isNaN(date.getTime()) ? '-' : date.getDate()}</b><span>{Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en', { month: 'short' }).format(date).toUpperCase()}</span></div>
    <div className="event-main"><div><strong>{event.title}</strong><span><Clock3 size={13}/>{info.label} {info.date} {info.time}</span>{event.location && <span><MapPin size={13}/>{event.location}</span>}</div>{event.memo && <p>{event.memo}</p>}</div>
    <div className="row-actions"><button onClick={() => edit(event)} title="編集"><Edit3 size={16}/></button><button onClick={() => remove(event.id)} title="削除"><Trash2 size={16}/></button></div>
  </article>
}

function DiaryPage({ moodLogs, diaries, saveMood, saveDiary }: { moodLogs: MoodLog[]; diaries: DiaryEntry[]; saveMood: (mood: Mood, memo: string, date?: string) => void; saveDiary: (entry: DiaryEntry) => void }) {
  const createDraft = (date = localDate()): DiaryEntry => {
    const existing = diaries.find(entry => entry.date === date)
    if (existing) return existing
    const mood = moodLogs.find(log => log.date === date)?.mood ?? 'normal', now = new Date().toISOString()
    return { id: crypto.randomUUID(), date, mood, doneToday: '', hardThings: '', carryOver: '', freeMemo: '', aiComment: '', createdAt: now, updatedAt: now }
  }
  const [draft, setDraft] = useState<DiaryEntry>(() => createDraft())
  const [saved, setSaved] = useState(false)
  const update = (key: keyof DiaryEntry, value: string) => { setDraft(prev => ({ ...prev, [key]: value })); setSaved(false) }
  const changeDate = (date: string) => { setDraft(createDraft(date)); setSaved(false) }
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const now = new Date().toISOString(), aiComment = makeDiaryComment(draft)
    const entry = { ...draft, aiComment, updatedAt: now }
    saveDiary(entry); saveMood(entry.mood, moodLogs.find(log => log.date === entry.date)?.memo ?? '', entry.date); setDraft(entry); setSaved(true)
  }
  const sorted = [...diaries].sort((a,b) => b.date.localeCompare(a.date))
  return <><PageHeading eyebrow="PRIVATE JOURNAL" title="日記・気分ログ">数行だけで構いません。一日の手触りを、明日の作戦に変えましょう。</PageHeading><div className="diary-layout"><form className="card diary-form" onSubmit={submit}><div className="diary-form-head"><div><span>NEW ENTRY</span><h2>今日を短く振り返る</h2></div><Field label="日付"><input type="date" value={draft.date} onChange={e => changeDate(e.target.value)}/></Field></div><div className="diary-mood"><span>今日の気分</span><div className="mood-buttons compact">{moodOptions.map(item => <button type="button" key={item.value} className={draft.mood === item.value ? `selected mood-${item.value}` : ''} onClick={() => update('mood', item.value)}><b>{item.emoji}</b><span>{item.label}</span></button>)}</div></div><div className="diary-fields"><Field label="今日できたこと"><textarea value={draft.doneToday} onChange={e => update('doneToday', e.target.value)} placeholder="例：資料を開いた、授業に行けた"/></Field><Field label="しんどかったこと"><textarea value={draft.hardThings} onChange={e => update('hardThings', e.target.value)} placeholder="例：寝不足で集中できなかった"/></Field><Field label="明日に回すこと"><textarea value={draft.carryOver} onChange={e => update('carryOver', e.target.value)} placeholder="例：見出しを3つ作る"/></Field><Field label="自由メモ"><textarea value={draft.freeMemo} onChange={e => update('freeMemo', e.target.value)} placeholder="何でも、短くて構いません"/></Field></div><button className="primary diary-save"><Sparkles size={16}/>{saved ? '日記を保存しました' : '日記を保存して振り返る'}</button>{draft.aiComment && <div className="diary-ai"><div className="avatar butler">B</div><div><span>BUTLER'S REFLECTION</span><p>{draft.aiComment}</p></div></div>}</form><section className="card diary-history"><div className="section-title"><div><span>ARCHIVE</span><h2>これまでの日記</h2></div><small>{sorted.length}件</small></div>{sorted.length ? <div className="diary-list">{sorted.map(entry => <article key={entry.id}><div className="diary-date"><b>{new Date(`${entry.date}T00:00:00`).getDate()}</b><span>{new Intl.DateTimeFormat('ja-JP',{month:'short'}).format(new Date(`${entry.date}T00:00:00`))}</span></div><div className="diary-summary"><div><span className="mood-chip">{moodInfo(entry.mood)?.emoji} {moodInfo(entry.mood)?.label}</span><time>{entry.date.replaceAll('-','.')}</time></div><h3>{entry.doneToday || '短い記録'}</h3><p>{entry.aiComment.split('\n')[0]}</p><button type="button" onClick={() => { setDraft(entry); setSaved(true); scrollTo({ top: 0, behavior: 'smooth' }) }}>日記を開く <ArrowRight size={13}/></button></div></article>)}</div> : <div className="diary-empty"><NotebookPen/><h3>最初の日記を書きましょう</h3><p>一行だけでも、明日の執事が少し賢くなります。</p></div>}</section></div></>
}

function Field({ label, children, wide, required }: { label:string; children:React.ReactNode; wide?:boolean; required?:boolean }) { return <label className={wide?'field wide':'field'}><span>{label}{required&&<b>*</b>}</span>{children}</label> }

function SettingsPage({ settings, setSettings, backup, restore, clear }: { settings: Settings; setSettings: React.Dispatch<React.SetStateAction<Settings>>; backup: AppBackup; restore:(data: AppBackup)=>boolean; clear:()=>void }) {
  const [backupMessage, setBackupMessage] = useState('')
  const update=<K extends keyof Settings>(k:K,v:Settings[K])=>setSettings(p=>({...defaultSettings,...p,[k]:v}))
  const actionSchemaUrl = `${location.origin}/gpt-action-openapi.json`
  const exportBackup = () => {
    const data: AppBackup = { ...backup, version: 1, exportedAt: new Date().toISOString(), settings }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `lady-butler-backup-${localDate()}.json`
    link.click()
    URL.revokeObjectURL(url)
    setBackupMessage('バックアップを書き出しました。スマホやPCの安全な場所に保管してください。')
  }
  const importBackup = async (file?: File | null) => {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as AppBackup
      const restored = restore(parsed)
      setBackupMessage(restored ? 'バックアップを読み込みました。執事の記憶を復元しました。' : '読み込みをキャンセルしました。')
    } catch {
      setBackupMessage('読み込めませんでした。Lady ButlerのバックアップJSONか確認してください。')
    }
  }
  return <><PageHeading eyebrow="PREFERENCES" title="設定">執事の振る舞いと、この端末に保存する情報を管理します。</PageHeading><section className="card settings-card"><div className="settings-section"><div><h2>プロフィール</h2><p>執事がお呼びする名前です。</p></div><Field label="お呼びする名前"><input value={settings.name} onChange={e=>update('name',e.target.value)} /></Field></div><div className="settings-section"><div><h2>執事の振る舞い</h2><p>いつでも後から変更できます。</p></div><div className="setting-controls"><Field label="口調"><select value={settings.tone} onChange={e=>update('tone',e.target.value as Settings['tone'])}><option>執事</option><option>やさしい</option><option>簡潔</option><option>イケメン</option></select></Field><Field label="厳しさ"><select value={settings.strictness} onChange={e=>update('strictness',e.target.value as Settings['strictness'])}><option>やさしめ</option><option>標準</option><option>厳しめ</option></select></Field><Field label="通知頻度"><select value={settings.notifications} onChange={e=>update('notifications',e.target.value as Settings['notifications'])}><option>少なめ</option><option>標準</option><option>多め</option></select></Field></div></div><div className="settings-section gpt-link-section"><div><h2>GPT連携</h2><p>あなたのCustom GPTのActionsにこのURLを登録すると、GPTで話した課題や予定をアプリの受信箱へ送れるようになります。</p></div><div className="gpt-link-box"><code>{actionSchemaUrl}</code><button onClick={() => navigator.clipboard.writeText(actionSchemaUrl)}><Copy size={15}/>URLをコピー</button><small>GPTが返す追加リンクを開くと、この端末の受信箱に入ります。勝手に保存確定はしません。</small></div></div><div className="settings-section backup-section"><div><h2>バックアップ</h2><p>タスク、予定、日記、気分ログ、GPT受信箱をJSONで保存・復元できます。機種変更やスマホ利用前の保険です。</p></div><div className="backup-box"><div className="backup-actions"><button type="button" onClick={exportBackup}><Download size={15}/>書き出す</button><label><Upload size={15}/>読み込む<input type="file" accept="application/json,.json" onChange={e=>{ importBackup(e.target.files?.[0]); e.currentTarget.value='' }}/></label></div><small>{backupMessage || 'この端末の保存データだけを扱います。クラウド同期ではありません。'}</small></div></div><div className="settings-section danger-zone"><div><h2>保存データ</h2><p>タスク、予定、日記、気分ログ、設定はこのブラウザ内に保存されます。</p></div><button onClick={() => confirm('すべてのデータを削除しますか？')&&clear()}><Trash2 size={16}/>保存データを削除</button></div></section></>
}

function EventModal({ event: initial, save, close }: { event: CalendarEvent; save:(event:CalendarEvent)=>void; close:()=>void }) {
  const [event,setEvent]=useState(initial)
  const datePart = (value: string) => value?.slice(0, 10) || localDate()
  const timePart = (value: string) => value?.slice(11, 16) || '10:00'
  const merge = (date: string, time: string) => `${date || localDate()}T${time || '10:00'}`
  const update=(k:keyof CalendarEvent,v:string)=>setEvent(p=>({...p,[k]:v}))
  const updateStart=(part:'date'|'time',value:string)=>setEvent(p=>{
    const oldStart = new Date(p.startAt), oldEnd = new Date(p.endAt)
    const duration = !Number.isNaN(oldStart.getTime()) && !Number.isNaN(oldEnd.getTime()) && oldEnd > oldStart ? oldEnd.getTime() - oldStart.getTime() : 60 * 60 * 1000
    const startAt = merge(part === 'date' ? value : datePart(p.startAt), part === 'time' ? value : timePart(p.startAt))
    const nextStart = new Date(startAt)
    const endAt = Number.isNaN(nextStart.getTime()) ? p.endAt : toLocalDateTimeValue(new Date(nextStart.getTime() + duration))
    return {...p,startAt,endAt}
  })
  const updateEnd=(part:'date'|'time',value:string)=>setEvent(p=>({...p,endAt:merge(part === 'date' ? value : datePart(p.endAt), part === 'time' ? value : timePart(p.endAt))}))
  const submit=(e:React.FormEvent)=>{
    e.preventDefault()
    if(!event.title.trim()) return
    const start = new Date(event.startAt), end = new Date(event.endAt)
    const fixedStart = Number.isNaN(start.getTime()) ? toLocalDateTimeValue(new Date()) : event.startAt
    const safeStart = new Date(fixedStart)
    const fixedEnd = Number.isNaN(end.getTime()) || end <= safeStart ? toLocalDateTimeValue(new Date(safeStart.getTime() + 60 * 60 * 1000)) : event.endAt
    save({...event,startAt:fixedStart,endAt:fixedEnd})
  }
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><form className="modal" onSubmit={submit}><div className="modal-head"><div><span>EVENT DETAILS</span><h2>{initial.title?'予定を編集':'新しい予定'}</h2></div><button type="button" onClick={close}><X/></button></div><div className="modal-body"><Field label="予定名" required><input autoFocus value={event.title} onChange={e=>update('title',e.target.value)} placeholder="例：ゼミ面談、美容院、バイト"/></Field><div className="form-grid event-date-grid"><Field label="開始日"><input value={datePart(event.startAt)} onChange={e=>updateStart('date',e.target.value)} placeholder="2026-07-03" inputMode="numeric"/></Field><Field label="開始時刻"><input value={timePart(event.startAt)} onChange={e=>updateStart('time',e.target.value)} placeholder="13:00" inputMode="numeric"/></Field><Field label="終了日"><input value={datePart(event.endAt)} onChange={e=>updateEnd('date',e.target.value)} placeholder="2026-07-03" inputMode="numeric"/></Field><Field label="終了時刻"><input value={timePart(event.endAt)} onChange={e=>updateEnd('time',e.target.value)} placeholder="14:00" inputMode="numeric"/></Field><Field label="場所" wide><input value={event.location} onChange={e=>update('location',e.target.value)} placeholder="例：研究室、駅前、オンライン"/></Field><Field label="メモ" wide><textarea value={event.memo} onChange={e=>update('memo',e.target.value)} placeholder="持ち物、待ち合わせ相手、準備など"/></Field></div></div><div className="modal-actions"><button type="button" onClick={close}>キャンセル</button><button className="primary" disabled={!event.title.trim()}><Check size={17}/>保存する</button></div></form></div>
}

function TaskModal({ task: initial, save, close }: { task: Task; save:(t:Task)=>void; close:()=>void }) {
  const [task,setTask]=useState(initial), update=(k:keyof Task,v:string|number)=>setTask(p=>({...p,[k]:v}))
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><form className="modal" onSubmit={e=>{e.preventDefault();if(task.title.trim())save(task)}}><div className="modal-head"><div><span>TASK DETAILS</span><h2>{initial.title?'タスクを編集':'新しいタスク'}</h2></div><button type="button" onClick={close}><X/></button></div><div className="modal-body"><Field label="タスク名" required><input autoFocus value={task.title} onChange={e=>update('title',e.target.value)} placeholder="何を片づけますか？"/></Field><div className="form-grid"><Field label="締切"><input type="datetime-local" value={task.deadline} onChange={e=>update('deadline',e.target.value)}/></Field><Field label="カテゴリ"><select value={task.category} onChange={e=>update('category',e.target.value)}>{['課題','授業','生活','バイト','予定','買い物','その他'].map(v=><option key={v}>{v}</option>)}</select></Field><Field label="優先度"><select value={task.priority} onChange={e=>update('priority',e.target.value)}><option>高</option><option>中</option><option>低</option></select></Field><Field label="所要時間（分）"><input type="number" min="5" step="5" value={task.estimatedMinutes} onChange={e=>update('estimatedMinutes',Number(e.target.value))}/></Field><Field label="進捗"><select value={task.progress} onChange={e=>update('progress',Number(e.target.value) as Progress)}>{[0,25,50,75,100].map(v=><option value={v} key={v}>{v}%</option>)}</select></Field><Field label="ステータス"><select value={task.status} onChange={e=>update('status',e.target.value as Status)}><option>未着手</option><option>進行中</option><option>完了</option><option>保留</option></select></Field><Field label="メモ" wide><textarea value={task.memo} onChange={e=>update('memo',e.target.value)} placeholder="資料、提出条件、最初の一手など"/></Field></div></div><div className="modal-actions"><button type="button" onClick={close}>キャンセル</button><button className="primary" disabled={!task.title.trim()}><Check size={17}/>保存する</button></div></form></div>
}

function Empty({text}:{text:string}) { return <div className="empty"><Archive/><p>{text}</p></div> }
