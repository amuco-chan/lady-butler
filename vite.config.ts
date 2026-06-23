import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = process.env.GITHUB_ACTIONS && repositoryName ? `/${repositoryName}/` : '/'

export default defineConfig(({ mode }) => {
  // Load env variables (including non-VITE_ ones) from .env.local
  const env = loadEnv(mode, process.cwd(), '')

  // Expose these to the backend handler in process.env
  process.env.OPENAI_API_KEY = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY
  process.env.APP_ACCESS_TOKEN = env.APP_ACCESS_TOKEN || process.env.APP_ACCESS_TOKEN || 'local-token'

  return {
    base,
    plugins: [
      react(),
      {
        name: 'local-api-middleware',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.url?.split('?')[0] === '/api/chat' && req.method === 'POST') {
              try {
                // Collect request body
                const chunks: any[] = []
                for await (const chunk of req) {
                  chunks.push(chunk)
                }
                const rawBody = Buffer.concat(chunks).toString('utf-8')

                // Mock req and res for the Vercel handler
                const mockedReq = {
                  method: req.method,
                  headers: req.headers,
                  body: rawBody,
                }

                const mockedRes = {
                  statusCode: 200,
                  status(code: number) {
                    this.statusCode = code
                    return this
                  },
                  json(data: any) {
                    res.statusCode = this.statusCode
                    res.setHeader('Content-Type', 'application/json')
                    res.end(JSON.stringify(data))
                    return this
                  }
                }

                // Import the Vercel serverless function
                // @ts-ignore
                const handlerModule = await import('./api/chat.js')
                await handlerModule.default(mockedReq, mockedRes)
              } catch (error: any) {
                res.statusCode = 500
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: error.message || 'Internal Server Error' }))
              }
              return
            }
            next()
          })

          // Print a helpful message when the server starts
          const originalPrintUrls = server.printUrls
          server.printUrls = () => {
            originalPrintUrls()
            console.log('\n  🤖 \x1b[32mReal AI Chat Local server enabled\x1b[0m')
            console.log('  ➜  AI access token is loaded without printing it.')
            console.log('  ➜  For no-cost use, keep Settings on "無料GPT相談モード".\n')
          }
        }
      }
    ],
  }
})
