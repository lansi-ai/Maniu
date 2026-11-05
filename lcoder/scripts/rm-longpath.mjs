// 删除 git worktree remove 删不掉的残留目录——pnpm 的嵌套 node_modules 在本机越过 MAX_PATH，
// 只有加 \\?\ 前缀才能绕过。参数必须是绝对路径（正斜杠即可）。
import fs from 'node:fs'

for (const target of process.argv.slice(2)) {
  const extended = '\\\\?\\' + target.replace(/\//g, '\\')
  try {
    fs.rmSync(extended, { recursive: true, maxRetries: 5, retryDelay: 200 })
    console.log('DELETED', target)
  } catch (error) {
    console.log('FAILED', target, String(error).slice(0, 140))
  }
}
