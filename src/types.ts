export type Category = '課題' | '授業' | '生活' | 'バイト' | '予定' | '買い物' | 'その他'
export type Priority = '高' | '中' | '低'
export type Status = '未着手' | '進行中' | '完了' | '保留'
export type Progress = 0 | 25 | 50 | 75 | 100
export type Page = 'home' | 'tasks' | 'calendar' | 'diary' | 'settings'
export type Mood = 'very_good' | 'good' | 'normal' | 'tired' | 'exhausted'
export type EventRecurrence = 'none' | 'daily' | 'weekly' | 'monthly'

export interface Task {
  id: string
  title: string
  deadline: string
  category: Category
  priority: Priority
  progress: Progress
  estimatedMinutes: number
  actualMinutes?: number
  status: Status
  memo: string
  createdAt: string
  updatedAt: string
}

export interface TaskWorkLog {
  id: string
  taskId: string
  taskTitle: string
  minutes: number
  date: string
  memo?: string
  createdAt: string
  updatedAt: string
}

export interface CalendarEvent {
  id: string
  title: string
  startAt: string
  endAt: string
  location: string
  memo: string
  recurrence?: EventRecurrence
  recurrenceUntil?: string
  source?: 'manual' | 'gpt' | 'ics'
  sourceEventId?: string
  createdAt: string
  updatedAt: string
}


export interface Settings {
  tone: '執事' | 'やさしい' | '簡潔' | 'イケメン'
  strictness: 'やさしめ' | '標準' | '厳しめ'
  notifications: '少なめ' | '標準' | '多め'
  name: string
  remindersEnabled: boolean
  reminderTime: string
  gptShareTasks: boolean
  gptShareMood: boolean
  gptShareDiary: boolean
}

export interface MoodLog {
  id: string
  date: string
  mood: Mood
  memo: string
  createdAt: string
  updatedAt: string
}

export interface DiaryEntry {
  id: string
  date: string
  mood: Mood
  doneToday: string
  hardThings: string
  carryOver: string
  freeMemo: string
  aiComment: string
  createdAt: string
  updatedAt: string
}

export interface GptInboxTaskItem {
  id: string
  type: 'task'
  title: string
  deadline: string
  category: Category
  priority: Priority
  estimatedMinutes: number
  memo: string
  sourceText: string
  createdAt: string
  confidence?: 'high' | 'medium' | 'low'
  ambiguities?: string[]
  deadlineIsFallback?: boolean
}

export interface GptInboxEventItem {
  id: string
  type: 'event'
  title: string
  startAt: string
  endAt: string
  location: string
  memo: string
  recurrence?: EventRecurrence
  recurrenceUntil?: string
  sourceText: string
  createdAt: string
  confidence?: 'high' | 'medium' | 'low'
  ambiguities?: string[]
  startIsFallback?: boolean
}

export type GptInboxItem = GptInboxTaskItem | GptInboxEventItem
