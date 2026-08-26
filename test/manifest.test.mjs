import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import yaml, { JSON_SCHEMA, Type } from 'js-yaml'

const require = createRequire(import.meta.url)

/**
 * DSH patch-dialect schema, mirroring the harness loader
 * (see @deepseek-ai/dsh-app-boot `userPatchesSchema`): JSON_SCHEMA plus the
 * `!!js` scalar used for inline expressions in patch configs.
 */
const jsExpr = new Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: String(data) }),
})
const patchSchema = JSON_SCHEMA.extend(jsExpr)

const readPatch = () => readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

test('dsh.bundle.patch 与 exports', () => {
  const pkg = require('../package.json')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(existsSync(new URL('../cordis.patch.yml', import.meta.url)))
  assert.equal(pkg.exports['./package.json'], './package.json')
})

test('cordis.patch.yml 能被 DSH patch 方言完整解析', () => {
  // Regression: v0.3.0 的 tarball 里有两行注释漏了 `#`，变成了注释块中间
  // 的缩进内容，任何 profile 组装都会直接失败。用真实 YAML 解析（而不是
  // 正则匹配）挡住这一类问题。
  const parsed = yaml.load(readPatch(), { schema: patchSchema })
  assert.ok(Array.isArray(parsed), '顶层必须是 loader patch 数组')
  assert.ok(parsed.length > 0, '至少一个 patch 条目')
  for (const [index, entry] of parsed.entries()) {
    assert.equal(typeof entry, 'object', `条目 ${index + 1} 必须是 mapping`)
    assert.notEqual(entry, null, `条目 ${index + 1} 不能为 null`)
  }
})

test('cordis.patch.yml 插入行名为 dsh-sql', () => {
  const parsed = yaml.load(readPatch(), { schema: patchSchema })
  const insert = parsed.find((entry) => entry && Array.isArray(entry.insert))
  assert.ok(insert, '必须存在 insert 条目')
  const names = insert.insert.map((row) => row.name)
  assert.ok(names.includes('dsh-sql'), `insert 行应包含 dsh-sql，实际为 ${names.join(', ')}`)
})

test('名称与版本', () => {
  const pkg = require('../package.json')
  assert.equal(pkg.name, 'dsh-sql')
  assert.equal(pkg.version, '0.4.0')
})
