import type { ChatMessage, ChatMode, DiaryEntry, MoodLog, Settings, Task } from './types'

interface AiChatRequest {
  input: string
  mode: ChatMode
  messages: ChatMessage[]
  tasks: Task[]
  moodLogs: MoodLog[]
  diaries: DiaryEntry[]
  settings: Settings
}

const endpoint = import.meta.env.VITE_AI_API_URL || '/api/chat'

export async function requestAiReply({ input, mode, messages, tasks, moodLogs, diaries, settings }: AiChatRequest) {
  if (!settings.aiAccessToken) throw new Error('AI access token is not configured')

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-App-Token': settings.aiAccessToken,
    },
    body: JSON.stringify({
      input,
      mode,
      history: messages.slice(-12).map(({ role, content }) => ({ role, content })),
      tasks: tasks.filter(task => task.status !== '完了').slice(0, 20),
      moodLogs: [...moodLogs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
      diaries: [...diaries].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3),
      settings: {
        name: settings.name,
        tone: settings.tone,
        strictness: settings.strictness,
      },
    }),
  })

  const data = await response.json().catch(() => ({})) as { reply?: string; error?: string }
  if (!response.ok || !data.reply) throw new Error(data.error || 'AI request failed')
  return data.reply
}
