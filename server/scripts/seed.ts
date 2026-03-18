/**
 * 种子数据导入脚本
 * 将 md-collection/ai_progress/ 下的学习笔记批量上传到知识库
 *
 * 用法：
 *   npx ts-node scripts/seed.ts
 *   npx ts-node scripts/seed.ts --dir /path/to/notes --host http://localhost:9527
 *   npx ts-node scripts/seed.ts --host http://localhost:9527 --reset
 */

import * as fs from 'fs'
import * as path from 'path'

type UploadItem = {
  ok?: boolean
  skipped?: boolean
  filename?: string
  chunks?: number
}

const DEFAULT_DIR = path.resolve(__dirname, '../../../md-collection/ai_progress')
const DEFAULT_HOST = 'http://localhost:9527'

async function main() {
  const args = process.argv.slice(2)
  const dirArg = args.indexOf('--dir')
  const hostArg = args.indexOf('--host')

  const dir = dirArg !== -1 ? args[dirArg + 1] : DEFAULT_DIR
  const host = hostArg !== -1 ? args[hostArg + 1] : DEFAULT_HOST
  const shouldReset = args.includes('--reset')

  if (!fs.existsSync(dir)) {
    console.error(`❌ 目录不存在: ${dir}`)
    process.exit(1)
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') || f.endsWith('.txt') || f.endsWith('.pdf'))
    .sort()

  if (files.length === 0) {
    console.error(`❌ 目录中没有可导入的文件（.md/.txt/.pdf）: ${dir}`)
    process.exit(1)
  }

  if (shouldReset) {
    console.log('🧹 先重置知识库...')
    const resetRes = await fetch(`${host}/ingest/reset`, { method: 'POST' })
    if (!resetRes.ok) {
      console.error(`❌ 重置知识库失败: HTTP ${resetRes.status}`)
      process.exit(1)
    }
  }

  console.log(`\n📚 共找到 ${files.length} 个文件，开始导入...\n`)

  let success = 0
  let skipped = 0
  let failed = 0

  for (const filename of files) {
    const filePath = path.join(dir, filename)
    const fileBuffer = fs.readFileSync(filePath)

    try {
      const form = new FormData()
      const ext = path.extname(filename).toLowerCase()
      const contentType =
        ext === '.pdf' ? 'application/pdf' : ext === '.txt' ? 'text/plain' : 'text/markdown'
      const fileBlob = new Blob([fileBuffer], { type: contentType })
      form.set('file', fileBlob, filename)

      const res = await fetch(`${host}/ingest/file`, {
        method: 'POST',
        body: form as unknown as BodyInit,
      })

      const body = await res.json().catch(() => ({})) as {
        skipped?: boolean
        uploaded?: UploadItem[]
      }

      if (!res.ok) {
        console.error(`  ✗ ${filename} — HTTP ${res.status}`)
        failed++
        continue
      }

      const upload = body.uploaded?.[0]
      const wasSkipped = upload?.skipped ?? body.skipped ?? false

      if (wasSkipped) {
        console.log(`  ⊙ ${filename} — 已存在，跳过`)
        skipped++
      } else {
        const chunkInfo = upload?.chunks ? ` — ${upload.chunks} chunks` : ''
        console.log(`  ✓ ${filename}${chunkInfo}`)
        success++
      }
    } catch (err) {
      console.error(`  ✗ ${filename} — ${(err as Error).message}`)
      failed++
    }
  }

  console.log(`\n✅ 导入完成：成功 ${success} | 跳过 ${skipped} | 失败 ${failed}\n`)

  if (failed > 0) {
    console.warn('⚠️  部分文件导入失败，请确认后端已启动（默认 http://localhost:9527）')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
