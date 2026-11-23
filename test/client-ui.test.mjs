import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { wrapClient } from '@stardustlc/dsh-updates/build'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const templatePath = resolve(root, 'templates/client.js')
const builtClientPath = resolve(root, 'lib/client.js')
const pkgPath = resolve(root, 'package.json')
const iconPath = resolve(root, 'assets/plugin-icon.webp')

function createMockReact() {
  const Fragment = Symbol('Fragment')
  let states = []
  let refs = []
  let stateCursor = 0
  let refCursor = 0
  const pendingEffects = []

  const React = {
    Fragment,
    createElement(type, props, ...children) {
      return {
        type,
        props: {
          ...(props || {}),
          children: children.length === 0 ? undefined : (children.length === 1 ? children[0] : children),
        },
      }
    },
    cloneElement(el, props, ...children) {
      return {
        ...el,
        props: {
          ...(el.props || {}),
          ...(props || {}),
          ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}),
        },
      }
    },
    useState(initial) {
      const idx = stateCursor++
      if (!(idx in states)) {
        states[idx] = typeof initial === 'function' ? initial() : initial
      }
      const setState = next => {
        states[idx] = typeof next === 'function' ? next(states[idx]) : next
      }
      return [states[idx], setState]
    },
    useRef(initial) {
      const idx = refCursor++
      if (!(idx in refs)) {
        refs[idx] = { current: initial }
      }
      return refs[idx]
    },
    useEffect(fn) {
      pendingEffects.push(fn)
    },
    useLayoutEffect(fn) {
      pendingEffects.push(fn)
    },
    useId() {
      return 'mock-id'
    },
  }

  function renderTree(element, { keepState = false, stopAt = null } = {}) {
    if (!keepState) {
      states = []
      refs = []
    }
    stateCursor = 0
    refCursor = 0
    pendingEffects.length = 0

    function expand(node) {
      if (node == null || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') {
        return node
      }
      if (Array.isArray(node)) {
        return node.map(expand)
      }
      if (typeof node === 'object' && typeof node.type === 'function') {
        if (stopAt && stopAt(node)) return node
        return expand(node.type(node.props || {}))
      }
      if (typeof node === 'object' && node.props && node.props.children !== undefined) {
        return {
          ...node,
          props: {
            ...node.props,
            children: expand(node.props.children),
          },
        }
      }
      return node
    }

    return expand(element)
  }

  function flushEffects() {
    const cleanups = []
    while (pendingEffects.length > 0) {
      const fn = pendingEffects.shift()
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    }
    return cleanups
  }

  return { React, renderTree, flushEffects }
}

function collectText(node, out = []) {
  if (node == null || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const item of node) collectText(item, out)
    return out
  }
  if (typeof node === 'object' && node.props && node.props.children !== undefined) {
    collectText(node.props.children, out)
  }
  return out
}

function findNodes(node, predicate, out = []) {
  if (node == null || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const item of node) findNodes(item, predicate, out)
    return out
  }
  if (predicate(node)) out.push(node)
  if (node.props && node.props.children !== undefined) {
    findNodes(node.props.children, predicate, out)
  }
  return out
}

function loadClientSource() {
  if (existsSync(builtClientPath)) {
    return { source: readFileSync(builtClientPath, 'utf8'), fromDisk: true }
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const raw = readFileSync(templatePath, 'utf8').replace(/\r\n/g, '\n')
  const iconData = existsSync(iconPath)
    ? 'data:image/webp;base64,' + readFileSync(iconPath).toString('base64')
    : null
  return { source: wrapClient(raw, pkg.name, pkg.version, iconData), fromDisk: false }
}

function executeClientInVm(source, { fetchImpl, initialLocale = 'zh-CN' } = {}) {
  const mockReact = createMockReact()
  const loaded = []
  const styles = new Map()
  const headChildren = []

  const mockDocument = {
    baseURI: 'http://127.0.0.1:3000/',
    head: {
      appendChild(el) {
        headChildren.push(el)
        if (el.id) styles.set(el.id, el)
        return el
      },
    },
    getElementById(id) {
      return styles.get(id) || null
    },
    createElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        id: '',
        textContent: '',
        remove() {
          if (el.id) styles.delete(el.id)
        },
      }
      return el
    },
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll() { return [] },
  }

  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(def) {
          loaded.push(def)
        },
      },
      addEventListener() {},
      removeEventListener() {},
    },
    document: mockDocument,
    URL,
    AbortController,
    crypto: globalThis.crypto,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    Set,
    Map,
    WeakMap,
    Symbol,
    fetch: fetchImpl || (async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      async json() {
        return {
          snapshot: {
            revision: 'rev-1',
            writable: true,
            implicitMemoryDefault: true,
            connections: [
              {
                name: 'default',
                engine: 'sqlite',
                file: ':memory:',
                readOnly: false,
                hasPassword: false,
                passwordSource: 'none',
                passwordEnvVar: 'DSH_SQL_PASSWORD_DEFAULT',
              },
            ],
            guardrails: {
              maxRows: 1000,
              readOnly: false,
              writeApproval: true,
              queryTimeoutMs: 60000,
              execTimeoutMs: 120000,
              redactMode: 'off',
              redactColumns: [],
            },
          },
        }
      },
    })),
  }
  sandbox.globalThis = sandbox

  vm.runInNewContext(source, sandbox, { filename: 'lib/client.js' })
  assert.equal(loaded.length, 1, 'Expected exactly one __ModuleLoader__.load() registration')

  const modDef = loaded[0]
  assert.equal(modDef.id, 'dsh-sql')
  assert.equal(typeof modDef.factory, 'function')

  const plugin = modDef.factory(name => {
    if (name === 'react') return mockReact.React
    throw new Error('Unexpected require: ' + name)
  })

  let activeLocale = initialLocale
  const localeSubs = new Set()
  const registeredSlots = []
  const effects = []

  const localeService = {
    getSnapshot: () => ({ active: activeLocale }),
    subscribe(fn) {
      localeSubs.add(fn)
      return () => localeSubs.delete(fn)
    },
  }

  function createCtx({ throwOnSlots = new Set() } = {}) {
    const slots = {
      inject(slotName, cb) {
        if (throwOnSlots.has(slotName)) {
          throw new Error('Unsupported slot: ' + slotName)
        }
        return cb()
      },
      register(meta, component) {
        registeredSlots.push({ meta, component })
        return () => {}
      },
    }
    const ctx = {
      slots,
      locale: localeService,
      get(name) {
        if (name === 'locale') return localeService
        if (name === 'slots') return slots
        return undefined
      },
      effect(fn) {
        const dispose = fn()
        effects.push(dispose)
        return dispose
      },
      inject(deps, cb) {
        if (Array.isArray(deps) && deps.every(d => d === 'slots' || d === 'locale')) {
          return cb(ctx)
        }
        return undefined
      },
    }
    return ctx
  }

  function setLocale(next) {
    activeLocale = next
    for (const fn of localeSubs) fn()
  }

  return {
    plugin,
    mockReact,
    createCtx,
    registeredSlots,
    setLocale,
    styles,
    effects,
  }
}

test('package.json exposes client entry, build pipeline, and settings UI injection', () => {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(Array.isArray(pkg.dsh.client.inject))
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'))
  assert.match(pkg.scripts.build, /build-client\.mjs.*build-updates\.mjs/)
})

test('templates/client.js, build scripts, and built lib/client.js (if present) pass node --check', () => {
  execFileSync(process.execPath, ['--check', templatePath], { stdio: 'pipe' })
  execFileSync(process.execPath, ['--check', resolve(root, 'scripts/build-client.mjs')], { stdio: 'pipe' })
  execFileSync(process.execPath, ['--check', resolve(root, 'scripts/build-updates.mjs')], { stdio: 'pipe' })
  if (existsSync(builtClientPath)) {
    execFileSync(process.execPath, ['--check', builtClientPath], { stdio: 'pipe' })
  }
})

test('wrapped client registers all 3 settings slots + whale-girl section icon and resolves zh/en locale thunks', () => {
  const { source } = loadClientSource()
  const env = executeClientInVm(source, { initialLocale: 'zh-CN' })

  assert.equal(typeof env.plugin.apply, 'function')
  assert.deepEqual([...env.plugin.inject], ['slots', 'locale'])

  const ctx = env.createCtx()
  env.plugin.apply(ctx)

  const section = env.registeredSlots.find(s => s.meta.name === 'settings.section' && s.meta.id === 'dsh-sql')
  const tab = env.registeredSlots.find(s => s.meta.name === 'settings.plugins.tab' && s.meta.id === 'dsh-sql')
  const bundle = env.registeredSlots.find(s => s.meta.name === 'plugins.bundle.config' && s.meta.key === 'dsh-sql')
  const icon = env.registeredSlots.find(s => s.meta.name === 'settings.section.icon' && s.meta.id === 'dsh-sql')

  assert.ok(section, 'settings.section slot with id "dsh-sql" must be registered')
  assert.equal(section.meta.order, 57)
  assert.ok(tab, 'settings.plugins.tab slot with id "dsh-sql" must be registered')
  assert.equal(tab.meta.order, 57)
  assert.ok(bundle, 'plugins.bundle.config slot with key "dsh-sql" must be registered')
  assert.ok(icon, 'settings.section.icon slot with id "dsh-sql" must be auto-registered by dsh-updates')

  // Verify scoped CSS injected once
  assert.ok(env.styles.has('dsh-sql-settings-style'), 'Scoped stylesheet should be injected once')

  // Verify zh locale labels
  assert.equal(section.meta.label(), '数据库')
  assert.equal(tab.meta.label(), '数据库')

  // Switch to en and verify locale thunks update dynamically
  env.setLocale('en-US')
  assert.equal(section.meta.label(), 'SQL Databases')
  assert.equal(tab.meta.label(), 'SQL')

  // Verify whale-girl icon renders an <img> with data:image/webp;base64
  const iconTree = env.mockReact.renderTree(env.mockReact.React.createElement(icon.component, { size: 20 }))
  assert.equal(iconTree.type, 'img')
  assert.match(iconTree.props.src, /^data:image\/webp;base64,/)
})

test('components render cleanly across section, tab, and bundle (page & summary) surfaces', () => {
  const { source } = loadClientSource()
  const env = executeClientInVm(source, { initialLocale: 'zh-CN' })
  const ctx = env.createCtx()
  env.plugin.apply(ctx)

  const section = env.registeredSlots.find(s => s.meta.name === 'settings.section')
  const tab = env.registeredSlots.find(s => s.meta.name === 'settings.plugins.tab')
  const bundle = env.registeredSlots.find(s => s.meta.name === 'plugins.bundle.config')
  const h = env.mockReact.React.createElement

  const stopAtFooter = node => node.type?.name === '__StardustPluginUpdatesFooter'

  // 1. settings.section -> surface="section", includes update footer
  const sectionTree = env.mockReact.renderTree(h(section.component, {}), { stopAt: stopAtFooter })
  assert.equal(sectionTree.type, 'section')
  assert.equal(sectionTree.props['data-surface'], 'section')
  assert.ok(collectText(sectionTree).join(' ').includes('数据库'))
  assert.equal(findNodes(sectionTree, stopAtFooter).length, 1, 'section surface should mount update footer')

  // 2. settings.plugins.tab -> surface="tab", includes update footer
  const tabTree = env.mockReact.renderTree(h(tab.component, {}), { stopAt: stopAtFooter })
  assert.equal(tabTree.type, 'section')
  assert.equal(tabTree.props['data-surface'], 'tab')
  assert.equal(findNodes(tabTree, stopAtFooter).length, 1, 'tab surface should mount update footer')

  // 3. plugins.bundle.config view="page" -> surface="bundle", NO duplicate update footer
  const bundlePageTree = env.mockReact.renderTree(h(bundle.component, { view: 'page' }), { stopAt: stopAtFooter })
  assert.equal(bundlePageTree.type, 'section')
  assert.equal(bundlePageTree.props['data-surface'], 'bundle')
  assert.equal(findNodes(bundlePageTree, stopAtFooter).length, 0, 'bundle surface must not duplicate native update footer')

  // 4. plugins.bundle.config view="summary" -> concise localized one-line text
  const summaryZh = env.mockReact.renderTree(h(bundle.component, { view: 'summary' }))
  assert.match(collectText(summaryZh).join(''), /SQLite.*MySQL.*PostgreSQL/)

  env.setLocale('en-US')
  const summaryEn = env.mockReact.renderTree(h(bundle.component, { view: 'summary' }))
  assert.match(collectText(summaryEn).join(''), /Manage SQLite, MySQL, and PostgreSQL/)
})

test('optional slot injection failure does not prevent other slots from registering', () => {
  const { source } = loadClientSource()
  const env = executeClientInVm(source, { initialLocale: 'zh-CN' })
  const ctx = env.createCtx({ throwOnSlots: new Set(['settings.plugins.tab']) })

  assert.doesNotThrow(() => env.plugin.apply(ctx))
  assert.ok(env.registeredSlots.some(s => s.meta.name === 'settings.section' && s.meta.id === 'dsh-sql'))
  assert.ok(env.registeredSlots.some(s => s.meta.name === 'plugins.bundle.config' && s.meta.key === 'dsh-sql'))
})

test('initial fetch falls back from api/dsh-sql/settings (404) to _dsh/dsh-sql/settings with X-DSH-SQL header and renders snapshot', async () => {
  const calls = []
  const snapshot = {
    revision: 'rev-42',
    writable: true,
    implicitMemoryDefault: false,
    connections: [
      {
        name: 'prod',
        engine: 'postgres',
        host: 'db.internal',
        port: 5432,
        user: 'readonly',
        database: 'app',
        readOnly: true,
        ssl: 'verify-full',
        hasPassword: true,
        passwordSource: 'env',
        passwordEnvVar: 'DSH_SQL_PASSWORD_PROD',
      },
    ],
    guardrails: {
      maxRows: 500,
      readOnly: false,
      writeApproval: true,
      queryTimeoutMs: 30000,
      execTimeoutMs: 90000,
      redactMode: 'builtin',
      redactColumns: [],
    },
  }

  const { source } = loadClientSource()
  const env = executeClientInVm(source, {
    initialLocale: 'zh-CN',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init })
      if (String(url).includes('/api/dsh-sql/settings')) {
        return {
          ok: false,
          status: 404,
          headers: { get: () => 'text/plain' },
          async json() { throw new Error('Not JSON') },
        }
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        async json() { return { snapshot } },
      }
    },
  })

  const ctx = env.createCtx()
  env.plugin.apply(ctx)
  const section = env.registeredSlots.find(s => s.meta.name === 'settings.section')
  const h = env.mockReact.React.createElement
  const stopAtFooter = node => node.type?.name === '__StardustPluginUpdatesFooter'

  env.mockReact.renderTree(h(section.component, {}), { stopAt: stopAtFooter })
  env.mockReact.flushEffects()

  // Allow microtasks from async fetch to settle
  await new Promise(resolve => setTimeout(resolve, 15))

  assert.equal(calls.length, 2)
  assert.match(calls[0].url, /\/api\/dsh-sql\/settings$/)
  assert.equal(calls[0].init.headers['X-DSH-SQL'], '1')
  assert.equal(calls[0].init.credentials, 'same-origin')
  assert.match(calls[1].url, /\/_dsh\/dsh-sql\/settings$/)
  assert.equal(calls[1].init.headers['X-DSH-SQL'], '1')

  const loadedTree = env.mockReact.renderTree(h(section.component, {}), { keepState: true, stopAt: stopAtFooter })
  const text = collectText(loadedTree).join(' ')
  assert.match(text, /prod/)
  assert.match(text, /PostgreSQL/)
  assert.match(text, /readonly@db\.internal:5432\/app/)
  assert.match(text, /SSL · verify-full/)
  assert.match(text, /环境变量密码/)
})

test('unwrapped templates/client.js executes cleanly without dsh-updates globals', () => {
  const raw = readFileSync(templatePath, 'utf8')
  const env = executeClientInVm(raw, { initialLocale: 'en-US' })
  const ctx = env.createCtx()
  assert.doesNotThrow(() => env.plugin.apply(ctx))

  const section = env.registeredSlots.find(s => s.meta.name === 'settings.section')
  assert.ok(section)
  assert.equal(section.meta.label(), 'SQL Databases')

  const tree = env.mockReact.renderTree(env.mockReact.React.createElement(section.component, {}))
  assert.equal(tree.type, 'section')
  assert.match(collectText(tree).join(' '), /SQL Databases/)
})

test('interactive connection add/test/save/delete and guardrails save call the pinned HTTP contract', async () => {
  const requests = []
  let currentSnapshot = {
    revision: 'rev-1',
    writable: true,
    implicitMemoryDefault: true,
    connections: [
      {
        name: 'default',
        engine: 'sqlite',
        file: ':memory:',
        readOnly: false,
        hasPassword: false,
        passwordSource: 'none',
        passwordEnvVar: 'DSH_SQL_PASSWORD_DEFAULT',
      },
    ],
    guardrails: {
      maxRows: 1000,
      readOnly: false,
      writeApproval: true,
      queryTimeoutMs: 60000,
      execTimeoutMs: 120000,
      redactMode: 'off',
      redactColumns: [],
    },
  }

  const { source } = loadClientSource()
  const env = executeClientInVm(source, {
    initialLocale: 'zh-CN',
    fetchImpl: async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : null
      requests.push({ url: String(url), method: init.method, headers: init.headers, body })
      if (!body) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          async json() { return { snapshot: currentSnapshot } },
        }
      }
      if (body.action === 'testConnection') {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          async json() { return { test: { ok: true, durationMs: 7, tableCount: 3 }, snapshot: currentSnapshot } },
        }
      }
      if (body.action === 'saveConnection') {
        currentSnapshot = {
          ...currentSnapshot,
          revision: 'rev-2',
          implicitMemoryDefault: false,
          connections: [
            {
              name: body.connection.name,
              engine: body.connection.engine,
              file: body.connection.file,
              readOnly: Boolean(body.connection.readOnly),
              hasPassword: false,
              passwordSource: 'none',
              passwordEnvVar: 'DSH_SQL_PASSWORD_LOCAL',
            },
          ],
        }
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          async json() { return { saved: body.connection.name, snapshot: currentSnapshot } },
        }
      }
      if (body.action === 'saveGuardrails') {
        currentSnapshot = {
          ...currentSnapshot,
          revision: 'rev-3',
          guardrails: {
            maxRows: body.maxRows,
            readOnly: body.readOnly,
            writeApproval: body.writeApproval,
            queryTimeoutMs: body.queryTimeoutMs,
            execTimeoutMs: body.execTimeoutMs,
            redactMode: body.redactColumns === true ? 'builtin' : Array.isArray(body.redactColumns) ? 'custom' : 'off',
            redactColumns: Array.isArray(body.redactColumns) ? body.redactColumns : [],
          },
        }
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          async json() { return { saved: true, snapshot: currentSnapshot } },
        }
      }
      if (body.action === 'removeConnection') {
        currentSnapshot = {
          ...currentSnapshot,
          revision: 'rev-4',
          implicitMemoryDefault: true,
          connections: [],
        }
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          async json() { return { removed: body.name, snapshot: currentSnapshot } },
        }
      }
      throw new Error('Unexpected action: ' + body.action)
    },
  })

  const ctx = env.createCtx()
  env.plugin.apply(ctx)
  const section = env.registeredSlots.find(s => s.meta.name === 'settings.section')
  const h = env.mockReact.React.createElement
  const stopAtFooter = node => node.type?.name === '__StardustPluginUpdatesFooter'
  const rerender = () => env.mockReact.renderTree(h(section.component, {}), { keepState: true, stopAt: stopAtFooter })

  // Mount & load initial GET snapshot
  env.mockReact.renderTree(h(section.component, {}), { stopAt: stopAtFooter })
  env.mockReact.flushEffects()
  await new Promise(resolve => setTimeout(resolve, 15))

  let tree = rerender()
  assert.match(collectText(tree).join(' '), /内置 :memory: 临时内存库/)

  // Click "+ 添加连接"
  const addBtn = findNodes(tree, n => n.type === 'button' && collectText(n).join('').includes('添加连接'))[0]
  assert.ok(addBtn)
  addBtn.props.onClick()
  tree = rerender()

  // Fill connection name & SQLite file path
  const inputs = findNodes(tree, n => n.type === 'input' && n.props.type === 'text')
  inputs[0].props.onChange({ target: { value: 'local' } })
  inputs[2].props.onChange({ target: { value: 'E:\\data\\app.db' } })
  tree = rerender()

  // Test draft connection
  const testDraftBtn = findNodes(tree, n => n.type === 'button' && collectText(n).join('').includes('测试草稿连接'))[0]
  assert.ok(testDraftBtn)
  await testDraftBtn.props.onClick()
  tree = rerender()
  assert.match(collectText(tree).join(' '), /7ms.*3 张表/)

  // Submit connection form
  const connForm = findNodes(tree, n => n.type === 'form' && n.props.className === 'dsh-sql-form-card')[0]
  assert.ok(connForm)
  await connForm.props.onSubmit({ preventDefault() {} })
  tree = rerender()
  assert.match(collectText(tree).join(' '), /连接已保存并即时生效/)
  assert.match(collectText(tree).join(' '), /E:\\data\\app\.db/)

  // Configure guardrails -> custom redact mode & submit
  const selects = findNodes(tree, n => n.type === 'select')
  const redactSelect = selects[selects.length - 1]
  redactSelect.props.onChange({ target: { value: 'custom' } })
  tree = rerender()

  const redactTextarea = findNodes(tree, n => n.type === 'textarea')[0]
  assert.ok(redactTextarea, 'Textarea should appear when redactMode === "custom"')
  redactTextarea.props.onChange({ target: { value: 'phone\n/^secret_/i' } })
  tree = rerender()

  const guardrailsForm = findNodes(tree, n => n.type === 'form' && n.props.className === 'dsh-sql-section')[0]
  assert.ok(guardrailsForm)
  await guardrailsForm.props.onSubmit({ preventDefault() {} })
  tree = rerender()
  assert.match(collectText(tree).join(' '), /安全护栏设置已保存/)

  // Inline delete confirm -> confirm delete
  const deleteBtn = findNodes(tree, n => n.type === 'button' && collectText(n).join('') === '删除')[0]
  assert.ok(deleteBtn)
  deleteBtn.props.onClick()
  tree = rerender()
  const confirmDeleteBtn = findNodes(tree, n => n.type === 'button' && collectText(n).join('') === '确认删除')[0]
  assert.ok(confirmDeleteBtn)
  await confirmDeleteBtn.props.onClick()
  tree = rerender()

  // Verify exact pinned request payloads
  const actions = requests.map(r => r.body ? r.body.action : 'GET')
  assert.deepEqual(actions, ['GET', 'testConnection', 'saveConnection', 'saveGuardrails', 'removeConnection'])
  assert.deepEqual(requests[1].body, {
    action: 'testConnection',
    connection: { name: 'local', engine: 'sqlite', readOnly: false, file: 'E:\\data\\app.db' },
  })
  assert.deepEqual(requests[2].body, {
    action: 'saveConnection',
    connection: { name: 'local', engine: 'sqlite', readOnly: false, file: 'E:\\data\\app.db' },
    revision: 'rev-1',
  })
  assert.deepEqual(requests[3].body, {
    action: 'saveGuardrails',
    maxRows: 1000,
    readOnly: false,
    writeApproval: true,
    queryTimeoutMs: 60000,
    execTimeoutMs: 120000,
    redactColumns: ['phone', '/^secret_/i'],
    revision: 'rev-2',
  })
  assert.deepEqual(requests[4].body, {
    action: 'removeConnection',
    name: 'local',
    revision: 'rev-3',
  })
  for (const r of requests) {
    assert.equal(r.headers['X-DSH-SQL'], '1')
    if (r.method === 'POST') assert.equal(r.headers['Content-Type'], 'application/json')
  }
})

test('custom SSL CA field renders as textarea and preserves multi-line PEM round-trip', async () => {
  const pem = '-----BEGIN CERTIFICATE-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A\n-----END CERTIFICATE-----'
  const savedBodies = []
  let currentSnapshot = {
    revision: 'rev-ssl-1',
    writable: true,
    implicitMemoryDefault: false,
    connections: [
      {
        name: 'pg-custom',
        engine: 'postgres',
        host: 'db.internal',
        port: 5432,
        user: 'app',
        database: 'main',
        readOnly: false,
        ssl: { rejectUnauthorized: false, ca: pem },
        hasPassword: true,
        passwordSource: 'config',
        passwordEnvVar: 'DSH_SQL_PASSWORD_PG_CUSTOM',
      },
    ],
    guardrails: {
      maxRows: 1000,
      readOnly: false,
      writeApproval: true,
      queryTimeoutMs: 60000,
      execTimeoutMs: 120000,
      redactMode: 'off',
      redactColumns: [],
    },
  }

  const { source } = loadClientSource()
  const env = executeClientInVm(source, {
    initialLocale: 'zh-CN',
    fetchImpl: async (_url, init) => {
      const body = init.body ? JSON.parse(init.body) : null
      if (!body) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          async json() { return { snapshot: currentSnapshot } },
        }
      }
      savedBodies.push(body)
      currentSnapshot = {
        ...currentSnapshot,
        revision: 'rev-ssl-2',
        connections: [{
          ...currentSnapshot.connections[0],
          ssl: body.connection.ssl,
        }],
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        async json() { return { saved: body.connection.name, snapshot: currentSnapshot } },
      }
    },
  })

  const ctx = env.createCtx()
  env.plugin.apply(ctx)
  const section = env.registeredSlots.find(s => s.meta.name === 'settings.section')
  const h = env.mockReact.React.createElement
  const stopAtFooter = node => node.type?.name === '__StardustPluginUpdatesFooter'
  const rerender = () => env.mockReact.renderTree(h(section.component, {}), { keepState: true, stopAt: stopAtFooter })

  env.mockReact.renderTree(h(section.component, {}), { stopAt: stopAtFooter })
  env.mockReact.flushEffects()
  await new Promise(resolve => setTimeout(resolve, 15))

  let tree = rerender()
  const editBtn = findNodes(tree, n => n.type === 'button' && collectText(n).join('') === '编辑')[0]
  assert.ok(editBtn)
  editBtn.props.onClick()
  tree = rerender()

  const connForm = findNodes(tree, n => n.type === 'form' && n.props.className === 'dsh-sql-form-card')[0]
  assert.ok(connForm)
  const caTextarea = findNodes(connForm, n => n.type === 'textarea')[0]
  assert.ok(caTextarea, 'sslCa field must render as <textarea> when sslMode === "custom"')
  assert.equal(caTextarea.props.value, pem)

  const updatedPem = '-----BEGIN CERTIFICATE-----\nUPDATED_LINE_1\nUPDATED_LINE_2\n-----END CERTIFICATE-----'
  caTextarea.props.onChange({ target: { value: updatedPem } })
  tree = rerender()

  const updatedForm = findNodes(tree, n => n.type === 'form' && n.props.className === 'dsh-sql-form-card')[0]
  await updatedForm.props.onSubmit({ preventDefault() {} })

  assert.equal(savedBodies.length, 1)
  assert.equal(savedBodies[0].action, 'saveConnection')
  assert.equal(savedBodies[0].originalName, 'pg-custom')
  assert.deepEqual(savedBodies[0].connection.ssl, {
    rejectUnauthorized: false,
    ca: updatedPem,
  })
})
