/**
 * 种子数据导入脚本
 * 将 md-collection/ai_progress/ 下的学习笔记批量上传到知识库
 *
 * 用法：
 *   npx ts-node scripts/seed.ts
 *   npx ts-node scripts/seed.ts --dir /path/to/notes --host http://localhost:8788
 */

import * as fs from 'fs'
import * as path from 'path'
import { FormData, File } from 'formdata-node'

const DEFAULT_DIR = path.resolve(__dirname, '../../../md-collection/ai_progress')
const DEFAULT_HOST = 'http://localhost:8788'

async function main() {
  const args = process.argv.slice(2)
  const dirArg = args.indexOf('--dir')
  const hostArg = args.indexOf('--host')

  const dir = dirArg !== -1 ? args[dirArg + 1] : DEFAULT_DIR
  const host = hostArg !== -1 ? args[hostArg + 1] : DEFAULT_HOST

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

  console.log(`\n📚 共找到 ${files.length} 个文件，开始导入...\n`)

  let success = 0
  let skipped = 0
  let failed = 0

  for (const filename of files) {
    const filePath = path.join(dir, filename)
    const fileBuffer = fs.readFileSync(filePath)

    try {
      const form = new FormData()
      form.set('file', new File([fileBuffer], filename, { type: 'text/markdown' }))

      const res = await fetch(`${host}/ingest/file`, {
        method: 'POST',
        body: form as unknown as BodyInit,
      })

      const body = await res.json().catch(() => ({})) as Record<string, unknown>

      if (!res.ok) {
        console.error(`  ✗ ${filename} — HTTP ${res.status}`)
        failed++
        continue
      }

      if (body.skipped) {
        console.log(`  ⊙ ${filename} — 已存在，跳过`)
        skipped++
      } else {
        console.log(`  ✓ ${filename}`)
        success++
      }
    } catch (err) {
      console.error(`  ✗ ${filename} — ${(err as Error).message}`)
      failed++
    }
  }

  console.log(`\n✅ 导入完成：成功 ${success} | 跳过 ${skipped} | 失败 ${failed}\n`)

  if (failed > 0) {
    console.warn('⚠️  部分文件导入失败，请确认后端已启动（默认 http://localhost:8788）')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
