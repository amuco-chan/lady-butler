import { useMemo, useRef, useState } from 'react'
import { Archive, ArrowRight, BookOpen, CalendarDays, Check, CheckCircle2, ChevronDown, Circle, Clock3, Edit3, FileText, Home, Menu, MessageCircle, NotebookPen, Plus, Search, Send, Settings as SettingsIcon, Sparkles, Trash2, X } from 'lucide-react'
import type { ChatMessage, ChatMode, DiaryEntry, Mood, MoodLog, Page, Progress, Settings, Status, Task } from './types'
import { assignmentOutput, dayPlan, defaultSettings, formatDeadline, initialMessages, isTaskAddRequest, localDate, makeButlerReply, makeDiaryComment, moodGuidance, moodInfo, moodOptions, rankedTasks, sampleTasks, taskAddedReply, taskFromChat, toLocalDateTimeValue, useStoredState } from './lib'

const nav: { id: Page; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'ホーム', icon: Home }, { id: 'tasks', label: 'タスク', icon: CheckCircle2 },
  { id: 'chat', label: '執事に相談', icon: MessageCircle }, { id: 'diary', label: '日記・気分', icon: NotebookPen },
  { id: 'assignment', label: '課題サポート', icon: BookOpen }, { id: 'settings', label: '設定', icon: SettingsIcon },
]

const blankTask = (): Task => ({ id: crypto.randomUUID(), title: '', deadline: toLocalDateTimeValue(new Date(Date.now() + 86400000)), category: '課題', priority: '中', progress: 0, estimatedMinutes: 60, status: '未着手', memo: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })

export default function App() {
  const [page, setPage] = useState<Page>('home')
  const [tasks, setTasks] = useStoredState<Task[]>('lady.tasks', sampleTasks)
  const [messages, setMessages] = useStoredState<ChatMessage[]>('lady.messages', initialMessages())
  const [moodLogs, setMoodLogs] = useStoredState<MoodLog[]>('lady.moods', [])
  const [diaries, setDiaries] = useStoredState<DiaryEntry[]>('lady.diaries', [])
  const [settings, setSettings] = useStoredState<Settings>('lady.settings', defaultSettings)
  const [editing, setEditing] = useState<Task | null>(null)
  const [menu, setMenu] = useState(false)
  const changePage = (p: Page) => { setPage(p); setMenu(false) }
  const saveTask = (task: Task) => { setTasks(prev => prev.some(t => t.id === task.id) ? prev.map(t => t.id === task.id ? { ...task, updatedAt: new Date().toISOString() } : t) : [...prev, task]); setEditing(null) }
  const complete = (id: string) => setTasks(prev => prev.map(t => t.id === id ? { ...t, progress: t.status === '完了' ? 0 : 100, status: t.status === '完了' ? '未着手' : '完了', updatedAt: new Date().toISOString() } : t))
  const saveMood = (mood: Mood, memo: string, date = localDate()) => setMoodLogs(prev => {
    const existing = prev.find(log => log.date === date), now = new Date().toISOString()
    return existing ? prev.map(log => log.date === date ? { ...log, mood, memo, updatedAt: now } : log) : [{ id: crypto.randomUUID(), date, mood, memo, createdAt: now, updatedAt: now }, ...prev]
  })
  const saveDiary = (entry: DiaryEntry) => setDiaries(prev => prev.some(item => item.date === entry.date) ? prev.map(item => item.date === entry.date ? entry : item) : [entry, ...prev])

  return <div className="app-shell">
    <aside className={`sidebar ${menu ? 'open' : ''}`}>
      <div className="brand"><div className="crest">L</div><div><strong>Lady's Butler</strong><span>Personal assistant</span></div><button className="icon-button mobile-close" onClick={() => setMenu(false)}><X size={20}/></button></div>
      <nav>{nav.map(item => <button key={item.id} title={item.label} className={page === item.id ? 'active' : ''} onClick={() => changePage(item.id)}><item.icon size={19}/><span>{item.label}</span>{item.id === 'tasks' && <em>{tasks.filter(t => t.status !== '完了').length}</em>}</button>)}</nav>
      <div className="sidebar-quote"><Sparkles size={16}/><p>完璧でなくて構いません。<br/>まず提出できる形に。</p></div>
      <div className="profile-mini"><div className="avatar">L</div><div><strong>{settings.name || 'レディ'}</strong><span>本日もお供します</span></div></div>
    </aside>
    {menu && <div className="scrim" onClick={() => setMenu(false)}/>} 
    <main>
      <header className="topbar"><button className="icon-button menu-button" onClick={() => setMenu(true)}><Menu/></button><div className="breadcrumbs"><span>Lady's Butler</span><i>/</i><b>{nav.find(n => n.id === page)?.label}</b></div><button className="quick-add" onClick={() => setEditing(blankTask())}><Plus size={17}/>タスクを追加</button></header>
      <div className="page-wrap">
        {page === 'home' && <HomePage tasks={tasks} moodLogs={moodLogs} go={changePage} complete={complete}/>} 
        {page === 'tasks' && <TasksPage tasks={tasks} edit={setEditing} remove={id => setTasks(p => p.filter(t => t.id !== id))} complete={complete}/>} 
        {page === 'chat' && <ChatPage tasks={tasks} moodLogs={moodLogs} diaries={diaries} messages={messages} setMessages={setMessages} settings={settings} addTask={task => setTasks(prev => [...prev, task])}/>}
        {page === 'diary' && <DiaryPage moodLogs={moodLogs} diaries={diaries} saveMood={saveMood} saveDiary={saveDiary}/>} 
        {page === 'assignment' && <GeneratorPage/>}
        {page === 'settings' && <SettingsPage settings={settings} setSettings={setSettings} clear={() => { localStorage.clear(); location.reload() }}/>} 
      </div>
    </main>
    <nav className="mobile-tabbar" aria-label="スマートフォン用メニュー">{nav.map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => changePage(item.id)}><item.icon size={19}/><span>{item.label}</span>{item.id === 'tasks' && tasks.filter(t => t.status !== '完了').length > 0 && <em>{tasks.filter(t => t.status !== '完了').length}</em>}</button>)}</nav>
    {editing && <TaskModal task={editing} save={saveTask} close={() => setEditing(null)}/>} 
  </div>
}

function PageHeading({ eyebrow, title, children, action }: { eyebrow?: string; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <span>{eyebrow}</span>}<h1>{title}</h1>{children && <p>{children}</p>}</div>{action}</div>
}

function HomePage({ tasks, moodLogs, go, complete }: { tasks: Task[]; moodLogs: MoodLog[]; go: (p: Page) => void; complete: (id: string) => void }) {
  const todayMood = moodLogs.find(log => log.date === localDate())?.mood
  const plan = dayPlan(tasks, todayMood), incomplete = tasks.filter(t => t.status !== '完了')
  const date = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())
  const guidance = moodGuidance(todayMood)
  return <>
    <PageHeading eyebrow={date} title="お帰りなさいませ、レディ。">本日も、やるべきことを静かに片づけてまいりましょう。</PageHeading>
    <section className="butler-callout"><div className="butler-mark"><Sparkles/></div><div><span>THE BUTLER'S NOTE</span><h2>{plan.top ? `本日の最優先は「${plan.top.title}」です。` : '本日の予定はすべて片づいております。'}</h2><p>{todayMood ? guidance : plan.top ? `完璧を目指す必要はありません。まず10分で「${plan.top.category === '課題' ? '資料を開き、見出しを3つ作る' : '必要なものを1つ開く'}」ところから始めましょう。` : '少し休むか、明日の準備をひとつだけしておきましょう。'}</p></div><button onClick={() => go('chat')}>執事に相談する <ArrowRight size={16}/></button></section>
    <div className="stats-row"><Stat icon={<CheckCircle2/>} label="未完了タスク" value={`${incomplete.length}`} suffix="件"/><Stat icon={<Clock3/>} label="今日の予定時間" value={`${plan.today.reduce((n,t) => n + Math.round(t.estimatedMinutes * (100-t.progress)/100), 0)}`} suffix="分"/><Stat icon={<CalendarDays/>} label="締切間近" value={`${incomplete.filter(t => formatDeadline(t.deadline).urgent).length}`} suffix="件" danger/></div>
    <div className="home-grid">
      <section className="card today-card"><div className="section-title"><div><span>TODAY'S FOCUS</span><h2>今日やること</h2></div><button className="text-button" onClick={() => go('tasks')}>すべて見る <ArrowRight size={15}/></button></div>
        <div className="task-stack">{plan.today.length ? plan.today.map((task, i) => <TaskRow key={task.id} task={task} rank={i + 1} complete={complete}/>) : <Empty text="本日のタスクはありません"/>}</div>
        {plan.top && <div className="first-ten"><div><Clock3 size={18}/><strong>最初の10分</strong></div><p>{plan.top.category === '課題' ? '資料を開き、タイトルと見出しを3つだけ書く。' : `「${plan.top.title}」に必要なものを1つ開く。`}</p><button onClick={() => go('chat')}>このタスクを相談</button></div>}
      </section>
      <section className="card deadline-card"><div className="section-title"><div><span>UPCOMING</span><h2>締切が近いもの</h2></div></div>{rankedTasks(tasks).slice(0,4).map(t => { const d = formatDeadline(t.deadline); return <div className="deadline-row" key={t.id}><div className={`date-tile ${d.urgent ? 'urgent' : ''}`}><b>{new Date(t.deadline).getDate()}</b><span>{new Intl.DateTimeFormat('en', { month: 'short' }).format(new Date(t.deadline)).toUpperCase()}</span></div><div><strong>{t.title}</strong><span>{t.category} ・ {d.date}</span></div><div className={`badge priority-${t.priority}`}>{t.priority}</div></div>})}</section>
    </div>
  </>
}

function Stat({ icon, label, value, suffix, danger }: { icon: React.ReactNode; label: string; value: string; suffix: string; danger?: boolean }) { return <div className={`stat ${danger ? 'danger' : ''}`}><div>{icon}</div><span>{label}</span><strong>{value}<small>{suffix}</small></strong></div> }

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

function ChatPage({ tasks, moodLogs, diaries, messages, setMessages, settings, addTask }: { tasks: Task[]; moodLogs: MoodLog[]; diaries: DiaryEntry[]; messages: ChatMessage[]; setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>; settings: Settings; addTask: (task: Task) => void }) {
  const [mode, setMode] = useState<ChatMode>('通常相談'), [input, setInput] = useState(''), end = useRef<HTMLDivElement>(null), sending = useRef(false)
  const latestMood = [...moodLogs].sort((a,b) => b.date.localeCompare(a.date))[0]
  const send = () => {
    const text = input.trim()
    if (!text || sending.current) return
    sending.current = true
    const created = taskFromChat(text)
    const duplicate = created && tasks.some(task => task.status !== '完了' && task.title === created.task.title && task.deadline === created.task.deadline)
    if (created && !duplicate) addTask(created.task)
    const content = duplicate ? `レディ、「${created.task.title}」は同じ締切ですでに登録されています。二重登録はいたしませんでした。` : created ? taskAddedReply(created) : isTaskAddRequest(text) ? '承知しました、レディ。追加する内容を教えてください。例：「明日18時までに心理学レポートを提出するタスクを追加して」' : makeButlerReply(text, mode, tasks, moodLogs, [...diaries].sort((a,b) => b.date.localeCompare(a.date)), settings, messages)
    const createdAt = new Date().toISOString()
    const user: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text, createdAt, mode }
    const reply: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content, createdAt: new Date().toISOString(), mode }
    setMessages(p => [...p, user, reply]); setInput(''); setTimeout(() => { sending.current = false; end.current?.scrollIntoView({ behavior:'smooth' }) }, 50)
  }
  return <div className="chat-page"><PageHeading eyebrow="PRIVATE SALON" title="執事に相談">雑な言葉で構いません。状況を整理し、次の一手にいたします。</PageHeading><div className="chat-layout"><aside className="chat-context"><span>相談モード</span>{(['通常相談','タスク相談','課題サポート','進捗報告'] as ChatMode[]).map(m => <button className={m===mode?'active':''} onClick={() => setMode(m)} key={m}>{m}</button>)}<div className="context-note"><b>現在の最優先</b><p>{dayPlan(tasks, latestMood?.mood).top?.title || 'タスクなし'}</p>{latestMood && <small>{moodInfo(latestMood.mood)?.emoji} {moodInfo(latestMood.mood)?.label}として調整中</small>}</div></aside><section className="chat-card"><div className="chat-header"><div className="avatar butler">B</div><div><strong>Butler</strong><span><i/> お仕えしています</span></div><small>{mode}</small></div><div className="messages">{messages.map(m => <div className={`message ${m.role}`} key={m.id}>{m.role==='assistant' && <div className="avatar butler">B</div>}<div><p>{m.content}</p><span>{new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit'}).format(new Date(m.createdAt))}</span></div></div>)}<div ref={end}/></div><div className="suggestions">{['今日なにすればいい？','課題やばい','進捗だめ'].map(v => <button key={v} onClick={() => setInput(v)}>{v}</button>)}</div><div className="composer"><textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()} }} placeholder="相談、または「○○をタスクに追加して」"/><button onClick={send}><Send size={18}/></button></div><small className="composer-note">Enterで送信 ・ 締切や時間も文章から読み取ります</small></section></div></div>
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

function GeneratorPage() {
  const [data, setData] = useState<Record<string,string>>({ style: '大学生らしく' }), [output, setOutput] = useState(''), [loading, setLoading] = useState(false)
  const set = (k:string,v:string) => setData(p=>({...p,[k]:v})), generate = () => { setLoading(true); setTimeout(() => { setOutput(assignmentOutput(data)); setLoading(false) }, 500) }
  return <><PageHeading eyebrow="ASSIGNMENT STUDIO" title="課題サポート">あなたの考えを中心に、提出できる文章へ整えます。</PageHeading><div className="generator-grid"><section className="card form-card"><div className="form-card-title"><FileText/><div><h2>課題の情報</h2><p>分かる範囲だけで構いません。空欄は未指定として扱います。</p></div></div><div className="form-grid"><Field label="授業名"><input value={data.className||''} onChange={e=>set('className',e.target.value)} placeholder="例：社会心理学"/></Field><Field label="文字数"><input value={data.wordCount||''} onChange={e=>set('wordCount',e.target.value)} placeholder="例：800字"/></Field><Field label="課題文" wide><textarea value={data.prompt||''} onChange={e=>set('prompt',e.target.value)} placeholder="課題文をそのまま貼り付けてください"/></Field><Field label="先生の指示" wide><textarea value={data.instruction||''} onChange={e=>set('instruction',e.target.value)} placeholder="形式、必須項目、注意点など"/></Field><Field label="自分の意見・メモ" wide><textarea value={data.memo||''} onChange={e=>set('memo',e.target.value)} placeholder="箇条書きや雑な言葉で構いません"/></Field><Field label="使う資料"><input value={data.materials||''} onChange={e=>set('materials',e.target.value)} placeholder="資料名・URLなど"/></Field><Field label="希望する文体"><select value={data.style} onChange={e=>set('style',e.target.value)}><option>大学生らしく</option><option>自然に</option><option>短め</option><option>一段落で</option><option>レポート調</option></select></Field></div><button className="primary generate" onClick={generate} disabled={loading}><Sparkles size={17}/>{loading?'整えています…':'構成と下書きを作る'}</button></section><section className={`card output-card ${output?'has-output':''}`}><div className="output-head"><div><span>OUTPUT</span><h2>執事からの提案</h2></div>{output&&<button onClick={()=>navigator.clipboard.writeText(output)}>コピー</button>}</div>{output?<pre>{output}</pre>:<div className="output-empty"><div><Sparkles/></div><h3>まだ提案はありません</h3><p>課題の情報を入力すると、意図・構成・下書き・チェックリストをまとめます。</p></div>}</section></div></>
}

function Field({ label, children, wide, required }: { label:string; children:React.ReactNode; wide?:boolean; required?:boolean }) { return <label className={wide?'field wide':'field'}><span>{label}{required&&<b>*</b>}</span>{children}</label> }

function SettingsPage({ settings, setSettings, clear }: { settings: Settings; setSettings: React.Dispatch<React.SetStateAction<Settings>>; clear:()=>void }) {
  const update=(k:keyof Settings,v:string)=>setSettings(p=>({...p,[k]:v}))
  return <><PageHeading eyebrow="PREFERENCES" title="設定">執事の振る舞いと、この端末に保存する情報を管理します。</PageHeading><section className="card settings-card"><div className="settings-section"><div><h2>プロフィール</h2><p>執事がお呼びする名前です。</p></div><Field label="お呼びする名前"><input value={settings.name} onChange={e=>update('name',e.target.value)} /></Field></div><div className="settings-section"><div><h2>執事の振る舞い</h2><p>いつでも後から変更できます。</p></div><div className="setting-controls"><Field label="口調"><select value={settings.tone} onChange={e=>update('tone',e.target.value)}><option>執事</option><option>やさしい</option><option>簡潔</option></select></Field><Field label="厳しさ"><select value={settings.strictness} onChange={e=>update('strictness',e.target.value)}><option>やさしめ</option><option>標準</option><option>厳しめ</option></select></Field><Field label="通知頻度"><select value={settings.notifications} onChange={e=>update('notifications',e.target.value)}><option>少なめ</option><option>標準</option><option>多め</option></select></Field></div></div><div className="settings-section danger-zone"><div><h2>保存データ</h2><p>タスク、会話、設定はこのブラウザ内だけに保存されます。</p></div><button onClick={() => confirm('すべてのデータを削除しますか？')&&clear()}><Trash2 size={16}/>保存データを削除</button></div></section></>
}

function TaskModal({ task: initial, save, close }: { task: Task; save:(t:Task)=>void; close:()=>void }) {
  const [task,setTask]=useState(initial), update=(k:keyof Task,v:string|number)=>setTask(p=>({...p,[k]:v}))
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><form className="modal" onSubmit={e=>{e.preventDefault();if(task.title.trim())save(task)}}><div className="modal-head"><div><span>TASK DETAILS</span><h2>{initial.title?'タスクを編集':'新しいタスク'}</h2></div><button type="button" onClick={close}><X/></button></div><div className="modal-body"><Field label="タスク名" required><input autoFocus value={task.title} onChange={e=>update('title',e.target.value)} placeholder="何を片づけますか？"/></Field><div className="form-grid"><Field label="締切"><input type="datetime-local" value={task.deadline} onChange={e=>update('deadline',e.target.value)}/></Field><Field label="カテゴリ"><select value={task.category} onChange={e=>update('category',e.target.value)}>{['課題','授業','生活','バイト','予定','買い物','その他'].map(v=><option key={v}>{v}</option>)}</select></Field><Field label="優先度"><select value={task.priority} onChange={e=>update('priority',e.target.value)}><option>高</option><option>中</option><option>低</option></select></Field><Field label="所要時間（分）"><input type="number" min="5" step="5" value={task.estimatedMinutes} onChange={e=>update('estimatedMinutes',Number(e.target.value))}/></Field><Field label="進捗"><select value={task.progress} onChange={e=>update('progress',Number(e.target.value) as Progress)}>{[0,25,50,75,100].map(v=><option value={v} key={v}>{v}%</option>)}</select></Field><Field label="ステータス"><select value={task.status} onChange={e=>update('status',e.target.value as Status)}><option>未着手</option><option>進行中</option><option>完了</option><option>保留</option></select></Field><Field label="メモ" wide><textarea value={task.memo} onChange={e=>update('memo',e.target.value)} placeholder="資料、提出条件、最初の一手など"/></Field></div></div><div className="modal-actions"><button type="button" onClick={close}>キャンセル</button><button className="primary" disabled={!task.title.trim()}><Check size={17}/>保存する</button></div></form></div>
}

function Empty({text}:{text:string}) { return <div className="empty"><Archive/><p>{text}</p></div> }
