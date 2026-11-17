import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

test('dsh.bundle.patch 与 exports', () => {
  const pkg = require('../package.json')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(existsSync(new URL('../cordis.patch.yml', import.meta.url)))
  assert.equal(pkg.exports['./package.json'], './package.json')
})

test('cordis.patch.yml 插入行名为 dsh-sql', () => {
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /name: 'dsh-sql'/)
  assert.match(patch, /- insert:/)
})

test('名称与版本', () => {
  const pkg = require('../package.json')
  assert.equal(pkg.name, 'dsh-sql')
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  assert.equal(pkg.dsh.manifestVersion, 1)
  assert.equal(pkg.exports['./locale/*.json'], './locale/*.json')
  assert.ok(existsSync(new URL('../locale/zh.json', import.meta.url)))
  assert.ok(existsSync(new URL('../locale/en.json', import.meta.url)))
})

test('Cordis 4 ctx.effect 异步卸载时关闭数据库连接并注销工具', async () => {
  const { apply } = await import('../lib/index.js')
  const active = new Set()
  const effects = []
  apply({
    tools: {
      register(def) {
        active.add(def.name)
        return () => active.delete(def.name)
      },
    },
    on() { return () => {} },
    effect(fn) { effects.push(fn()) },
  }, { connections: { mem: { engine: 'sqlite', file: ':memory:' } } })
  assert.equal(active.size, 6)
  for (const dispose of effects) await dispose?.()
  assert.equal(active.size, 0)
})
