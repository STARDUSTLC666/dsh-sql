// Editable browser settings UI for dsh-sql.
// Build with: node scripts/build-client.mjs && node scripts/build-updates.mjs
window.__ModuleLoader__.load({
  id: 'dsh-sql',
  factory: require => {
    const React = require('react');
    const { useState, useEffect, useRef } = React;
    const h = React.createElement;

    const PRIMARY_ROUTE = 'api/dsh-sql/settings';
    const FALLBACK_ROUTE = '_dsh/dsh-sql/settings';
    const STYLE_ID = 'dsh-sql-settings-style';
    const BUILTIN_REDACT_PATTERNS = [
      'password', 'passwd', 'pwd', 'secret', 'token', 'api_key',
      'apikey', 'access_key', 'private_key', 'credential', 'auth_key', 'session_key',
    ];
    const SSL_MODES = ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'];

    let activeRoute = PRIMARY_ROUTE;
    let currentLang = 'zh';
    const langListeners = new Set();

    const STRINGS = {
      navTitle: ['数据库', 'SQL Databases'],
      tabTitle: ['数据库', 'SQL'],
      pageTitle: ['数据库', 'SQL Databases'],
      pageSubtitle: [
        '管理 SQLite / MySQL / PostgreSQL 连接、一键测试连通性并配置只读与脱敏护栏，保存后立即生效。',
        'Manage SQLite, MySQL, and PostgreSQL connections, test connectivity, and configure safety guardrails live.',
      ],
      bundleSummary: [
        '管理 SQLite / MySQL / PostgreSQL 连接、连通性测试与只读/脱敏护栏',
        'Manage SQLite, MySQL, and PostgreSQL connections, connectivity tests, and safety guardrails',
      ],
      refresh: ['刷新', 'Refresh'],
      refreshing: ['刷新中…', 'Refreshing…'],
      addConnection: ['添加连接', 'Add connection'],
      loading: ['正在读取数据库配置…', 'Loading database settings…'],
      retry: ['重新加载', 'Retry'],
      dismiss: ['关闭', 'Dismiss'],
      readonlyBanner: [
        '当前配置为只读，无法在此页面保存更改。你仍可查看连接信息并测试连通性。',
        'Settings are currently read-only. You can still inspect connections and test connectivity.',
      ],
      memoryBanner: [
        '当前使用内置 :memory: 临时内存库，点击下方「添加连接」配置自己的 SQLite / MySQL / PostgreSQL。',
        'Currently using the built-in :memory: temporary database. Click "Add connection" below to configure your own SQLite, MySQL, or PostgreSQL database.',
      ],
      connectionsHeading: ['数据库连接', 'Database Connections'],
      connectionsCount: ['个连接', 'connections'],
      connectionCountOne: ['1 个连接', '1 connection'],
      emptyTitle: ['尚未配置外部数据库', 'No external databases configured'],
      emptyHint: [
        '点击「添加连接」配置本地 SQLite 文件，或连接 MySQL / PostgreSQL 数据库（支持直接粘贴连接 URI）。',
        'Click "Add connection" to add a local SQLite file or connect to MySQL / PostgreSQL (connection URIs supported).',
      ],
      badgeReadOnly: ['只读', 'Read-only'],
      badgeSsl: ['SSL', 'SSL'],
      badgePwdSaved: ['密码已保存', 'Password saved'],
      badgePwdEnv: ['环境变量密码', 'Env password'],
      badgeMemory: ['临时内存库', 'Temporary :memory:'],
      btnTest: ['测试连接', 'Test'],
      btnTesting: ['测试中…', 'Testing…'],
      btnEdit: ['编辑', 'Edit'],
      btnDelete: ['删除', 'Delete'],
      btnConfirmDelete: ['确认删除', 'Confirm delete'],
      btnCancel: ['取消', 'Cancel'],
      deletePrompt: ['确定删除连接', 'Remove connection'],
      testOk: ['连接成功', 'Connected'],
      testFailed: ['连接失败', 'Connection failed'],
      tablesUnit: ['张表', 'tables'],
      tableUnitOne: ['1 张表', '1 table'],

      // Add / Edit form
      formAddTitle: ['添加数据库连接', 'Add database connection'],
      formEditTitle: ['编辑连接', 'Edit connection'],
      fieldName: ['连接名称', 'Connection name'],
      fieldNamePlaceholder: ['例如：local、prod、analytics', 'e.g. local, prod, analytics'],
      fieldEngine: ['数据库引擎', 'Engine'],
      fieldUrl: ['连接 URI（可选）', 'Connection URI (optional)'],
      fieldUrlPlaceholderSqlite: ['sqlite:///E:/data/app.db（也可仅填下方文件路径）', 'sqlite:///path/to/app.db (or use File path below)'],
      fieldUrlPlaceholderMysql: ['mysql://user:pass@127.0.0.1:3306/app?sslmode=require', 'mysql://user:pass@127.0.0.1:3306/app?sslmode=require'],
      fieldUrlPlaceholderPg: ['postgres://user:pass@db.example.com:5432/app?sslmode=verify-full', 'postgres://user:pass@db.example.com:5432/app?sslmode=verify-full'],
      fieldUrlHint: [
        '可直接粘贴云库连接串（支持 ?sslmode=）；同时填写下方独立字段时以独立字段为准。',
        'Paste a full connection URI (supports ?sslmode=). Explicit fields below take precedence over URI parts.',
      ],
      fieldFile: ['SQLite 文件路径', 'SQLite file path'],
      fieldFilePlaceholder: ['E:\\data\\app.db 或 :memory:', '/path/to/app.db or :memory:'],
      fieldHost: ['主机地址 (Host)', 'Host'],
      fieldHostPlaceholder: ['127.0.0.1 或 db.example.com', '127.0.0.1 or db.example.com'],
      fieldPort: ['端口 (Port)', 'Port'],
      fieldDatabase: ['数据库名 (Database)', 'Database'],
      fieldDatabasePlaceholder: ['app', 'app'],
      fieldUser: ['用户名 (User)', 'Username'],
      fieldUserPlaceholder: ['readonly_user', 'readonly_user'],
      fieldPassword: ['密码 (Password)', 'Password'],
      pwdPlaceholderKeep: ['留空保留已存密码', 'Leave blank to keep saved password'],
      pwdPlaceholderEnv: ['当前由环境变量提供（填写将覆盖）', 'Provided by env var (enter to override)'],
      pwdPlaceholderNew: ['可选（推荐通过环境变量提供）', 'Optional (env var recommended)'],
      clearPasswordLabel: ['清除已存密码', 'Clear saved password'],
      pwdEnvHintPrefix: ['也可设置环境变量', 'Or set environment variable'],
      pwdEnvHintSuffix: ['，无需把密码写入配置。', ' instead of storing it in config.'],
      fieldSsl: ['TLS / SSL 模式', 'TLS / SSL mode'],
      sslDefault: ['默认 / 关闭', 'Default / Off'],
      sslDisable: ['disable（禁用 TLS）', 'disable (no TLS)'],
      sslAllow: ['allow（允许非加密）', 'allow (prefer non-TLS)'],
      sslPrefer: ['prefer（优先加密）', 'prefer (TLS if available)'],
      sslRequire: ['require（强制加密）', 'require (TLS required)'],
      sslVerifyCa: ['verify-ca（校验 CA 证书）', 'verify-ca (verify CA cert)'],
      sslVerifyFull: ['verify-full（校验 CA 与主机名）', 'verify-full (verify CA & host)'],
      sslTrue: ['启用 TLS (true)', 'Enabled (true)'],
      sslCustom: ['自定义 TLS 对象（CA / rejectUnauthorized）', 'Custom TLS object (CA / rejectUnauthorized)'],
      sslRejectUnauthorized: ['校验证书合法性 (rejectUnauthorized)', 'Verify server certificate (rejectUnauthorized)'],
      sslCaLabel: ['CA 证书路径或 PEM 原文（可选）', 'CA certificate path or PEM text (optional)'],
      sslCaPlaceholder: ['/path/to/ca.pem 或 -----BEGIN CERTIFICATE-----', '/path/to/ca.pem or -----BEGIN CERTIFICATE-----'],
      fieldConnReadOnly: ['仅限只读查询（禁用此连接的 sql_exec）', 'Read-only connection (disable sql_exec on this connection)'],
      btnTestDraft: ['测试草稿连接', 'Test draft'],
      btnSaveConn: ['保存连接', 'Save connection'],
      btnSaving: ['正在保存…', 'Saving…'],

      // Guardrails
      guardrailsHeading: ['安全护栏', 'Safety Guardrails'],
      guardrailsSubtitle: [
        '控制全局只读锁、写操作审批、查询行数/超时上限与敏感列脱敏，保存后热更新生效。',
        'Control global read-only lock, write approval, row and timeout limits, and sensitive column masking live.',
      ],
      grReadOnly: ['全局只读模式', 'Global read-only mode'],
      grReadOnlyDesc: [
        '开启后禁用所有连接的 sql_exec 写操作（适合纯只读分析场景）。',
        'Disable sql_exec write operations across every connection.',
      ],
      grWriteApproval: ['写操作审批门', 'Write approval gate'],
      grWriteApprovalDesc: [
        '执行写入或 DDL 前弹出审批卡并标注高危语句（DROP / TRUNCATE / 无 WHERE 更新删除）。',
        'Require interactive approval with risk warnings before writes or DDL.',
      ],
      grWriteApprovalWarn: [
        '当前允许不经审批直接执行写操作，请确认仅在受控测试环境使用。',
        'Writes can run without approval while both global read-only and write approval are off.',
      ],
      grMaxRows: ['单次最大行数', 'Max rows per query'],
      grMaxRowsHint: ['范围 1–10000（默认 1000）', 'Range 1–10000 (default 1000)'],
      grQueryTimeout: ['查询超时 (ms)', 'Query timeout (ms)'],
      grQueryTimeoutHint: ['范围 5000–600000（默认 60000）', 'Range 5000–600000 (default 60000)'],
      grExecTimeout: ['写操作超时 (ms)', 'Write timeout (ms)'],
      grExecTimeoutHint: ['范围 5000–600000（默认 120000）', 'Range 5000–600000 (default 120000)'],
      grRedactMode: ['敏感列脱敏 (redactColumns)', 'Sensitive column redaction'],
      grRedactOff: ['关闭', 'Off'],
      grRedactBuiltin: ['启用内置 12 条敏感列规则', 'Enable built-in 12 sensitive column rules'],
      grRedactCustom: ['自定义列名或 /正则/', 'Custom column substrings or /regex/'],
      grRedactBuiltinHint: [
        '内置匹配列名：',
        'Built-in column substrings: ',
      ],
      grRedactCustomLabel: ['脱敏规则（每行一条）', 'Redaction patterns (one per line)'],
      grRedactCustomPlaceholder: ['phone\nid_card\n/^secret_/i', 'phone\nssn\n/^secret_/i'],
      grRedactCustomHint: [
        '普通文本按列名不区分大小写子串匹配；/pattern/ 或 /pattern/iu 按正则匹配。命中单元格显示为 [REDACTED]。',
        'Plain text matches column names case-insensitively; /pattern/ or /pattern/iu uses RegExp. Matched non-null cells display as [REDACTED].',
      ],
      unsavedBadge: ['有未保存更改', 'Unsaved changes'],
      btnReset: ['还原', 'Reset'],
      btnSaveGuardrails: ['保存安全设置', 'Save guardrails'],

      // Notices & errors
      noticeConnSaved: ['连接已保存并即时生效。', 'Connection saved and applied live.'],
      noticeConnRemoved: ['连接已删除。', 'Connection removed.'],
      noticeGuardrailsSaved: ['安全护栏设置已保存并即时生效。', 'Safety guardrails saved and applied live.'],
      errLoad: ['无法读取数据库设置。请确认 DSH 正在运行后重试。', 'Unable to load database settings. Make sure DSH is running and retry.'],
      errSession: ['DSH 会话已失效，请刷新页面后重试。', 'DSH session expired. Reload the page and retry.'],
      errReadonly: ['当前配置为只读，无法保存修改。', 'Settings are read-only and cannot be modified.'],
      errConflict: ['配置已被其他窗口修改，请刷新最新配置后再保存。', 'Settings changed elsewhere. Refresh to load the latest revision before saving.'],
      errNotFound: ['未找到该连接，请刷新列表。', 'Connection not found. Refresh the list.'],
      errRequestFailed: ['操作失败，请稍后重试。', 'Request failed. Please try again.'],
      errNameRequired: ['请填写连接名称。', 'Enter a connection name.'],
      errSqliteTarget: ['请填写 SQLite 文件路径（如 :memory:）或连接 URI。', 'Enter a SQLite file path (e.g. :memory:) or connection URI.'],
      errRemoteTarget: ['请填写连接 URI，或提供数据库名与主机信息。', 'Enter a connection URI, or provide host and database details.'],
      errPortRange: ['端口必须是 1–65535 之间的整数。', 'Port must be an integer between 1 and 65535.'],
      errMaxRowsRange: ['最大行数必须是 1–10000 之间的整数。', 'Max rows must be an integer between 1 and 10000.'],
      errQueryTimeoutRange: ['查询超时必须是 5000–600000 之间的整数（毫秒）。', 'Query timeout must be an integer between 5000 and 600000 ms.'],
      errExecTimeoutRange: ['写操作超时必须是 5000–600000 之间的整数（毫秒）。', 'Write timeout must be an integer between 5000 and 600000 ms.'],
      errRedactCustomEmpty: ['自定义脱敏模式至少需要填写一条规则，或切换为「关闭」。', 'Enter at least one pattern for custom redaction, or switch to Off.'],
    };

    function textFor(key, lang) {
      const entry = STRINGS[key];
      if (!entry) return key;
      return entry[lang === 'en' ? 1 : 0];
    }

    function readLocale(ctx) {
      try {
        const service = (ctx && typeof ctx.get === 'function' ? ctx.get('locale') : null) || (ctx && ctx.locale);
        const snap = service && typeof service.getSnapshot === 'function' ? service.getSnapshot() : null;
        const raw = (snap && snap.active) || (service && (service.active || service.locale));
        if (raw) return String(raw).toLowerCase().startsWith('en') ? 'en' : 'zh';
      } catch {
        // Fallback to cached language
      }
      return currentLang;
    }

    function useLocale() {
      const [lang, setLang] = useState(currentLang);
      useEffect(() => {
        setLang(currentLang);
        const listener = next => setLang(next);
        langListeners.add(listener);
        return () => { langListeners.delete(listener); };
      }, []);
      return lang;
    }

    function passwordEnvName(name) {
      const cleaned = String(name || '').trim();
      return 'DSH_SQL_PASSWORD_' + (cleaned ? cleaned.toUpperCase().replace(/[^A-Z0-9_]/g, '_') : 'NAME');
    }

    function engineLabel(engine) {
      if (engine === 'mysql') return 'MySQL';
      if (engine === 'postgres') return 'PostgreSQL';
      return 'SQLite';
    }

    function formatTarget(conn) {
      if (conn.engine === 'sqlite') {
        return conn.file || ':memory:';
      }
      const userPart = conn.user ? conn.user + '@' : '';
      const hostPart = conn.host || 'localhost';
      const portPart = conn.port ? ':' + conn.port : '';
      const dbPart = conn.database ? '/' + conn.database : '';
      return userPart + hostPart + portPart + dbPart;
    }

    function formatSslBadge(ssl) {
      if (!ssl || ssl === false || ssl === 'disable' || ssl === 'allow') return '';
      if (typeof ssl === 'string') return 'SSL · ' + ssl;
      if (typeof ssl === 'object') {
        return ssl.rejectUnauthorized === false ? 'SSL · no-verify' : 'SSL · custom';
      }
      return 'SSL';
    }

    function draftFromConnection(conn) {
      if (!conn) {
        return {
          name: '',
          engine: 'sqlite',
          url: '',
          file: '',
          host: '',
          port: '',
          database: '',
          user: '',
          password: '',
          clearPassword: false,
          sslMode: '',
          sslRejectUnauthorized: true,
          sslCa: '',
          readOnly: false,
        };
      }
      let sslMode = '';
      let sslRejectUnauthorized = true;
      let sslCa = '';
      if (conn.ssl === true) {
        sslMode = 'true';
      } else if (conn.ssl === false) {
        sslMode = 'disable';
      } else if (typeof conn.ssl === 'string' && SSL_MODES.includes(conn.ssl)) {
        sslMode = conn.ssl;
      } else if (conn.ssl && typeof conn.ssl === 'object') {
        sslMode = 'custom';
        sslRejectUnauthorized = conn.ssl.rejectUnauthorized !== false;
        sslCa = typeof conn.ssl.ca === 'string' ? conn.ssl.ca : '';
      }
      return {
        name: conn.name || '',
        engine: conn.engine || 'sqlite',
        url: '',
        file: conn.file || '',
        host: conn.host || '',
        port: conn.port != null ? String(conn.port) : '',
        database: conn.database || '',
        user: conn.user || '',
        password: '',
        clearPassword: false,
        sslMode,
        sslRejectUnauthorized,
        sslCa,
        readOnly: Boolean(conn.readOnly),
      };
    }

    function guardrailsDraftFromSnapshot(guardrails) {
      const g = guardrails || {};
      const mode = g.redactMode === 'builtin' || g.redactMode === 'custom' ? g.redactMode : 'off';
      return {
        readOnly: Boolean(g.readOnly),
        writeApproval: g.writeApproval !== false,
        maxRows: String(g.maxRows ?? 1000),
        queryTimeoutMs: String(g.queryTimeoutMs ?? 60000),
        execTimeoutMs: String(g.execTimeoutMs ?? 120000),
        redactMode: mode,
        redactText: mode === 'custom' && Array.isArray(g.redactColumns) ? g.redactColumns.join('\n') : '',
      };
    }

    function parseCustomRedactLines(text) {
      return String(text || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    }

    function isGuardrailsDirty(draft, snapshot) {
      if (!draft || !snapshot || !snapshot.guardrails) return false;
      const base = guardrailsDraftFromSnapshot(snapshot.guardrails);
      if (draft.readOnly !== base.readOnly) return true;
      if (draft.writeApproval !== base.writeApproval) return true;
      if (String(draft.maxRows).trim() !== base.maxRows) return true;
      if (String(draft.queryTimeoutMs).trim() !== base.queryTimeoutMs) return true;
      if (String(draft.execTimeoutMs).trim() !== base.execTimeoutMs) return true;
      if (draft.redactMode !== base.redactMode) return true;
      if (draft.redactMode === 'custom') {
        const a = parseCustomRedactLines(draft.redactText);
        const b = parseCustomRedactLines(base.redactText);
        if (a.length !== b.length || a.some((v, i) => v !== b[i])) return true;
      }
      return false;
    }

    function buildConnectionPayload(draft, t) {
      const name = String(draft.name || '').trim();
      if (!name) return { error: t('errNameRequired') };

      const engine = draft.engine === 'mysql' || draft.engine === 'postgres' ? draft.engine : 'sqlite';
      const url = String(draft.url || '').trim();
      const conn = {
        name,
        engine,
        readOnly: Boolean(draft.readOnly),
      };
      if (url) conn.url = url;

      if (engine === 'sqlite') {
        const file = String(draft.file || '').trim();
        if (!file && !url) return { error: t('errSqliteTarget') };
        if (file) conn.file = file;
      } else {
        const host = String(draft.host || '').trim();
        const portRaw = String(draft.port || '').trim();
        const database = String(draft.database || '').trim();
        const user = String(draft.user || '').trim();
        if (!url && !database) return { error: t('errRemoteTarget') };
        if (host) conn.host = host;
        if (portRaw) {
          const portNum = Number(portRaw);
          if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
            return { error: t('errPortRange') };
          }
          conn.port = portNum;
        }
        if (database) conn.database = database;
        if (user) conn.user = user;
        if (draft.password && !draft.clearPassword) {
          conn.password = draft.password;
        }
        if (draft.sslMode === 'true') {
          conn.ssl = true;
        } else if (SSL_MODES.includes(draft.sslMode)) {
          conn.ssl = draft.sslMode;
        } else if (draft.sslMode === 'custom') {
          const sslObj = { rejectUnauthorized: Boolean(draft.sslRejectUnauthorized) };
          const ca = String(draft.sslCa || '').trim();
          if (ca) sslObj.ca = ca;
          conn.ssl = sslObj;
        }
      }

      return { connection: conn };
    }

    function buildGuardrailsPayload(draft, revision, t) {
      const maxRows = Number(String(draft.maxRows || '').trim());
      if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 10000) {
        return { error: t('errMaxRowsRange') };
      }
      const queryTimeoutMs = Number(String(draft.queryTimeoutMs || '').trim());
      if (!Number.isInteger(queryTimeoutMs) || queryTimeoutMs < 5000 || queryTimeoutMs > 600000) {
        return { error: t('errQueryTimeoutRange') };
      }
      const execTimeoutMs = Number(String(draft.execTimeoutMs || '').trim());
      if (!Number.isInteger(execTimeoutMs) || execTimeoutMs < 5000 || execTimeoutMs > 600000) {
        return { error: t('errExecTimeoutRange') };
      }
      let redactColumns = false;
      if (draft.redactMode === 'builtin') {
        redactColumns = true;
      } else if (draft.redactMode === 'custom') {
        const patterns = parseCustomRedactLines(draft.redactText);
        if (patterns.length === 0) {
          return { error: t('errRedactCustomEmpty') };
        }
        redactColumns = patterns;
      }
      return {
        payload: {
          maxRows,
          readOnly: Boolean(draft.readOnly),
          writeApproval: Boolean(draft.writeApproval),
          queryTimeoutMs,
          execTimeoutMs,
          redactColumns,
          revision,
        },
      };
    }

    function resolveApiUrl(route) {
      const base = (typeof document !== 'undefined' && document && document.baseURI)
        ? document.baseURI
        : 'http://127.0.0.1/';
      return new URL(route, base).toString();
    }

    async function apiRequest(action, args, lang, signal) {
      const t = key => textFor(key, lang);
      const makeInit = () => (action
        ? {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: {
              'Content-Type': 'application/json',
              'X-DSH-SQL': '1',
            },
            body: JSON.stringify({ action, ...(args || {}) }),
            signal,
          }
        : {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'X-DSH-SQL': '1' },
            signal,
          });

      async function send(route) {
        const response = await fetch(resolveApiUrl(route), makeInit());
        const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
        let data = null;
        let parsedJson = false;
        try {
          data = await response.json();
          parsedJson = data !== null && typeof data === 'object';
        } catch {
          parsedJson = false;
        }
        return { response, data, parsedJson, contentType };
      }

      let result = await send(activeRoute);
      const isRouteMissing404 =
        result.response.status === 404 &&
        activeRoute === PRIMARY_ROUTE &&
        (!action || !result.parsedJson || (!result.data?.error && !result.data?.code && !result.data?.snapshot));

      if (isRouteMissing404) {
        const fallback = await send(FALLBACK_ROUTE);
        if (fallback.response.status !== 404 || fallback.parsedJson) {
          activeRoute = FALLBACK_ROUTE;
          result = fallback;
        }
      }

      const { response, data, parsedJson } = result;
      if (!parsedJson) {
        throw new Error(response.status === 401 ? t('errSession') : t('errLoad'));
      }
      if (!response.ok) {
        let message = data.error || '';
        if (data.code === 'conflict') message = t('errConflict');
        else if (data.code === 'readonly') message = t('errReadonly');
        else if (data.code === 'not_found' && lang === 'en') message = t('errNotFound');
        if (!message) message = t('errRequestFailed');
        const err = new Error(message);
        err.code = data.code;
        err.status = response.status;
        if (data.snapshot) err.snapshot = data.snapshot;
        throw err;
      }
      return data;
    }

    const SETTINGS_CSS = `
.dsh-sql-root {
  --sql-text: var(--dsw-alias-label-primary, #1f2329);
  --sql-text-secondary: var(--dsw-alias-label-secondary, #646a73);
  --sql-text-tertiary: var(--dsw-alias-label-tertiary, #8f959e);
  --sql-card-fill: var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, 0.04)));
  --sql-card-stroke: var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.22)));
  --sql-surface: var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.08)));
  --sql-hover: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12));
  --sql-accent: var(--dsw-alias-border-selected, var(--dsh-plugin-workbench-accent, #4f6bdb));
  --sql-error: var(--dsw-alias-state-error-primary, #cf3636);
  --sql-success: var(--dsw-alias-state-success-primary, #1f884d);
  --sql-warning: var(--dsw-alias-state-warning-primary, #b26a00);
  --sql-radius: var(--dsw-radius-xl, 12px);
  --sql-input-bg: var(--dsw-specific-input-major, var(--dsw-alias-bg-base, transparent));
  box-sizing: border-box;
  color: var(--sql-text);
  font-family: var(--dsh-font-family-content, system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif);
  font-size: 14px;
  line-height: 1.55;
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  padding: 20px 24px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.dsh-sql-root[data-surface="bundle"] {
  max-width: 100%;
  padding: 6px 0 8px;
}
.dsh-sql-root *, .dsh-sql-root *::before, .dsh-sql-root *::after {
  box-sizing: border-box;
}
@media (prefers-color-scheme: dark) {
  .dsh-sql-root {
    --sql-text: var(--dsw-alias-label-primary, #eceef2);
    --sql-text-secondary: var(--dsw-alias-label-secondary, #a2a9b5);
    --sql-text-tertiary: var(--dsw-alias-label-tertiary, #7b8391);
  }
}
.dsh-sql-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px 16px;
}
.dsh-sql-header-text {
  min-width: 0;
  flex: 1 1 280px;
}
.dsh-sql-title {
  margin: 0;
  font-size: 20px;
  font-weight: 650;
  line-height: 1.3;
  letter-spacing: -0.015em;
  color: var(--sql-text);
}
.dsh-sql-root[data-surface="bundle"] .dsh-sql-title {
  font-size: 16px;
}
.dsh-sql-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--sql-text-secondary);
}
.dsh-sql-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.dsh-sql-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  padding: 5px 12px;
  border-radius: 8px;
  border: 1px solid var(--sql-card-stroke);
  background: var(--sql-card-fill);
  color: var(--sql-text);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  cursor: pointer;
  transition: background-color 0.14s ease, border-color 0.14s ease, opacity 0.14s ease;
}
.dsh-sql-btn:hover:not(:disabled) {
  background: var(--sql-hover);
}
.dsh-sql-btn:focus-visible {
  outline: 2px solid var(--sql-accent);
  outline-offset: 2px;
}
.dsh-sql-btn:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}
.dsh-sql-btn.is-primary {
  background: var(--sql-accent);
  border-color: var(--sql-accent);
  color: #fff;
}
.dsh-sql-btn.is-primary:hover:not(:disabled) {
  background: var(--sql-accent);
  opacity: 0.9;
}
.dsh-sql-btn.is-danger {
  color: var(--sql-error);
  border-color: color-mix(in srgb, var(--sql-error) 35%, var(--sql-card-stroke));
}
.dsh-sql-btn.is-danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--sql-error) 12%, transparent);
}
.dsh-sql-btn.is-danger-solid {
  background: var(--sql-error);
  border-color: var(--sql-error);
  color: #fff;
}
.dsh-sql-btn.is-danger-solid:hover:not(:disabled) {
  opacity: 0.9;
}
.dsh-sql-btn.is-sm {
  min-height: 28px;
  padding: 3px 10px;
  font-size: 12px;
}
.dsh-sql-banner {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid var(--sql-card-stroke);
  background: var(--sql-surface);
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.dsh-sql-banner.is-info {
  border-color: color-mix(in srgb, var(--sql-accent) 32%, var(--sql-card-stroke));
  background: color-mix(in srgb, var(--sql-accent) 9%, var(--sql-card-fill));
}
.dsh-sql-banner.is-success {
  color: var(--sql-success);
  border-color: color-mix(in srgb, var(--sql-success) 35%, var(--sql-card-stroke));
  background: color-mix(in srgb, var(--sql-success) 10%, var(--sql-card-fill));
}
.dsh-sql-banner.is-error {
  color: var(--sql-error);
  border-color: color-mix(in srgb, var(--sql-error) 40%, var(--sql-card-stroke));
  background: color-mix(in srgb, var(--sql-error) 10%, var(--sql-card-fill));
}
.dsh-sql-banner.is-warn {
  color: var(--sql-warning);
  border-color: color-mix(in srgb, var(--sql-warning) 35%, var(--sql-card-stroke));
  background: color-mix(in srgb, var(--sql-warning) 10%, var(--sql-card-fill));
}
.dsh-sql-banner-body {
  flex: 1 1 auto;
  min-width: 0;
}
.dsh-sql-banner-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.dsh-sql-section {
  border: 1px solid var(--sql-card-stroke);
  border-radius: var(--sql-radius);
  background: var(--sql-card-fill);
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.dsh-sql-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
}
.dsh-sql-section-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--sql-text);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.dsh-sql-section-desc {
  margin: 2px 0 0;
  font-size: 12.5px;
  color: var(--sql-text-secondary);
}
.dsh-sql-count {
  font-size: 12px;
  font-weight: 500;
  color: var(--sql-text-secondary);
  background: var(--sql-surface);
  padding: 1px 8px;
  border-radius: 999px;
}
.dsh-sql-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dsh-sql-conn-card {
  border: 1px solid var(--sql-card-stroke);
  border-radius: 10px;
  background: var(--sql-surface);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsh-sql-conn-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
}
.dsh-sql-conn-meta {
  min-width: 0;
  flex: 1 1 240px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dsh-sql-conn-name-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.dsh-sql-conn-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--sql-text);
  overflow-wrap: anywhere;
}
.dsh-sql-conn-target {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--sql-text-secondary);
  overflow-wrap: anywhere;
}
.dsh-sql-pill {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.5;
  background: var(--sql-card-fill);
  border: 1px solid var(--sql-card-stroke);
  color: var(--sql-text-secondary);
}
.dsh-sql-pill.is-sqlite {
  color: #3b6ea5;
  border-color: color-mix(in srgb, #3b6ea5 32%, transparent);
  background: color-mix(in srgb, #3b6ea5 12%, transparent);
}
.dsh-sql-pill.is-mysql {
  color: #b06c12;
  border-color: color-mix(in srgb, #b06c12 32%, transparent);
  background: color-mix(in srgb, #b06c12 12%, transparent);
}
.dsh-sql-pill.is-postgres {
  color: var(--sql-accent);
  border-color: color-mix(in srgb, var(--sql-accent) 35%, transparent);
  background: color-mix(in srgb, var(--sql-accent) 12%, transparent);
}
.dsh-sql-pill.is-warn {
  color: var(--sql-warning);
  border-color: color-mix(in srgb, var(--sql-warning) 30%, transparent);
  background: color-mix(in srgb, var(--sql-warning) 10%, transparent);
}
.dsh-sql-pill.is-ok {
  color: var(--sql-success);
  border-color: color-mix(in srgb, var(--sql-success) 30%, transparent);
  background: color-mix(in srgb, var(--sql-success) 10%, transparent);
}
.dsh-sql-test-result {
  font-size: 12.5px;
  line-height: 1.5;
  padding: 7px 10px;
  border-radius: 8px;
  overflow-wrap: anywhere;
  border: 1px solid var(--sql-card-stroke);
  background: var(--sql-card-fill);
}
.dsh-sql-test-result.is-ok {
  color: var(--sql-success);
  border-color: color-mix(in srgb, var(--sql-success) 32%, var(--sql-card-stroke));
  background: color-mix(in srgb, var(--sql-success) 8%, var(--sql-card-fill));
}
.dsh-sql-test-result.is-err {
  color: var(--sql-error);
  border-color: color-mix(in srgb, var(--sql-error) 35%, var(--sql-card-stroke));
  background: color-mix(in srgb, var(--sql-error) 8%, var(--sql-card-fill));
}
.dsh-sql-confirm-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--sql-error) 35%, var(--sql-card-stroke));
  background: color-mix(in srgb, var(--sql-error) 7%, var(--sql-card-fill));
  font-size: 12.5px;
}
.dsh-sql-empty {
  text-align: center;
  padding: 24px 16px;
  border: 1px dashed var(--sql-card-stroke);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.dsh-sql-empty-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.dsh-sql-empty-hint {
  margin: 0;
  font-size: 12.5px;
  color: var(--sql-text-secondary);
  max-width: 480px;
}
.dsh-sql-form-card {
  border: 1px solid color-mix(in srgb, var(--sql-accent) 45%, var(--sql-card-stroke));
  border-radius: 10px;
  background: var(--sql-surface);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.dsh-sql-form-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.dsh-sql-form-title {
  margin: 0;
  font-size: 14.5px;
  font-weight: 600;
}
.dsh-sql-grid-2 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
.dsh-sql-grid-3 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 12px;
}
.dsh-sql-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.dsh-sql-label {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--sql-text);
}
.dsh-sql-input,
.dsh-sql-select,
.dsh-sql-textarea {
  width: 100%;
  min-width: 0;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--sql-card-stroke);
  background: var(--sql-input-bg);
  color: var(--sql-text);
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
}
.dsh-sql-input,
.dsh-sql-select {
  min-height: 34px;
}
.dsh-sql-textarea {
  min-height: 82px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px;
}
.dsh-sql-input:focus,
.dsh-sql-select:focus,
.dsh-sql-textarea:focus {
  outline: none;
  border-color: var(--sql-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--sql-accent) 20%, transparent);
}
.dsh-sql-input:disabled,
.dsh-sql-select:disabled,
.dsh-sql-textarea:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.dsh-sql-hint {
  font-size: 12px;
  color: var(--sql-text-tertiary);
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.dsh-sql-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
.dsh-sql-checkbox-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--sql-text);
  cursor: pointer;
  user-select: none;
}
.dsh-sql-checkbox-row input[type="checkbox"] {
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--sql-accent);
  flex-shrink: 0;
}
.dsh-sql-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--sql-surface);
  border: 1px solid var(--sql-card-stroke);
}
.dsh-sql-toggle-copy {
  min-width: 0;
  flex: 1 1 auto;
}
.dsh-sql-toggle-title {
  font-size: 13.5px;
  font-weight: 550;
  color: var(--sql-text);
}
.dsh-sql-toggle-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--sql-text-secondary);
  line-height: 1.45;
}
.dsh-sql-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  cursor: pointer;
}
.dsh-sql-switch input {
  position: absolute;
  opacity: 0;
  width: 38px;
  height: 22px;
  margin: 0;
  cursor: pointer;
}
.dsh-sql-switch-track {
  width: 38px;
  height: 22px;
  border-radius: 999px;
  background: var(--sql-card-stroke);
  padding: 2px;
  display: block;
  transition: background-color 0.15s ease;
}
.dsh-sql-switch-track::before {
  content: "";
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.22);
  transition: transform 0.15s ease;
}
.dsh-sql-switch input:checked + .dsh-sql-switch-track {
  background: var(--sql-accent);
}
.dsh-sql-switch input:checked + .dsh-sql-switch-track::before {
  transform: translateX(16px);
}
.dsh-sql-switch input:focus-visible + .dsh-sql-switch-track {
  outline: 2px solid var(--sql-accent);
  outline-offset: 2px;
}
.dsh-sql-switch input:disabled + .dsh-sql-switch-track {
  opacity: 0.45;
  cursor: not-allowed;
}
.dsh-sql-form-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding-top: 4px;
}
.dsh-sql-loading {
  padding: 32px 16px;
  text-align: center;
  color: var(--sql-text-secondary);
  font-size: 13.5px;
}
.dsh-sql-summary {
  font-size: 13px;
  color: var(--dsw-alias-label-secondary, #646a73);
}
`;

    function ensureStyleInjected() {
      if (typeof document === 'undefined' || !document || !document.head) return null;
      const existing = document.getElementById(STYLE_ID);
      if (existing) return existing;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = SETTINGS_CSS;
      document.head.appendChild(style);
      return style;
    }

    function SqlSettingsPanel({ surface = 'section' } = {}) {
      const lang = useLocale();
      const t = key => textFor(key, lang);

      const [snapshot, setSnapshot] = useState(null);
      const [loading, setLoading] = useState(true);
      const [busy, setBusy] = useState('');
      const [error, setError] = useState('');
      const [errorCode, setErrorCode] = useState('');
      const [notice, setNotice] = useState('');

      // Connection add/edit form state
      const [formOpen, setFormOpen] = useState(false);
      const [editingOriginalName, setEditingOriginalName] = useState(null);
      const [editingPasswordSource, setEditingPasswordSource] = useState('none');
      const [connDraft, setConnDraft] = useState(() => draftFromConnection(null));
      const [formError, setFormError] = useState('');
      const [draftTest, setDraftTest] = useState(null);

      // Per-connection test results & inline delete confirmation
      const [connTests, setConnTests] = useState({});
      const [confirmDeleteName, setConfirmDeleteName] = useState('');

      // Guardrails draft
      const [grDraft, setGrDraft] = useState(() => guardrailsDraftFromSnapshot(null));
      const [grError, setGrError] = useState('');

      const mountedRef = useRef(true);
      const loadAbortRef = useRef(null);

      const grDirty = isGuardrailsDirty(grDraft, snapshot);
      const isDirty = formOpen || grDirty;
      const anyConnTesting = Object.values(connTests).some(item => item && item.loading);

      // Always invoke unconditionally at top level for React hook rules.
      if (typeof __stardustUpdatesGuard === 'function') {
        __stardustUpdatesGuard(React, 'dsh-sql', { dirty: isDirty, busy: !!busy || anyConnTesting });
      }

      useEffect(() => {
        ensureStyleInjected();
        mountedRef.current = true;
        return () => {
          mountedRef.current = false;
          if (loadAbortRef.current) {
            try { loadAbortRef.current.abort(); } catch {}
          }
        };
      }, []);

      async function loadSnapshot({ resetGuardrails = true } = {}) {
        if (loadAbortRef.current) {
          try { loadAbortRef.current.abort(); } catch {}
        }
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        loadAbortRef.current = controller;
        setLoading(prev => prev || !snapshot);
        setBusy('refresh');
        setError('');
        setErrorCode('');
        try {
          const data = await apiRequest(null, null, currentLang, controller?.signal);
          if (!mountedRef.current) return;
          const nextSnap = data.snapshot || null;
          setSnapshot(nextSnap);
          if (nextSnap && (resetGuardrails || !isGuardrailsDirty(grDraft, nextSnap))) {
            setGrDraft(guardrailsDraftFromSnapshot(nextSnap.guardrails));
          }
        } catch (err) {
          if (err && err.name === 'AbortError') return;
          if (!mountedRef.current) return;
          setError(err?.message || t('errLoad'));
          setErrorCode(err?.code || '');
        } finally {
          if (mountedRef.current) {
            setLoading(false);
            setBusy(prev => (prev === 'refresh' ? '' : prev));
          }
        }
      }

      useEffect(() => {
        void loadSnapshot({ resetGuardrails: true });
      }, []);

      const writable = snapshot ? snapshot.writable !== false : false;
      const connections = Array.isArray(snapshot?.connections) ? snapshot.connections : [];

      function openAddForm() {
        setFormError('');
        setDraftTest(null);
        setConfirmDeleteName('');
        setEditingOriginalName(null);
        setEditingPasswordSource('none');
        setConnDraft(draftFromConnection(null));
        setFormOpen(true);
      }

      function openEditForm(conn) {
        setFormError('');
        setDraftTest(null);
        setConfirmDeleteName('');
        const isSyntheticDefault = Boolean(snapshot?.implicitMemoryDefault);
        setEditingOriginalName(isSyntheticDefault ? null : conn.name);
        setEditingPasswordSource(isSyntheticDefault ? 'none' : (conn.passwordSource || 'none'));
        setConnDraft(draftFromConnection(conn));
        setFormOpen(true);
      }

      function closeForm() {
        setFormOpen(false);
        setFormError('');
        setDraftTest(null);
        setEditingOriginalName(null);
        setEditingPasswordSource('none');
      }

      function updateConnField(key, value) {
        setConnDraft(prev => ({ ...prev, [key]: value }));
        setFormError('');
      }

      async function handleTestSaved(connName) {
        setConnTests(prev => ({ ...prev, [connName]: { loading: true } }));
        try {
          const data = await apiRequest('testConnection', { name: connName }, currentLang);
          if (!mountedRef.current) return;
          const test = data.test || { ok: false, error: t('errRequestFailed') };
          setConnTests(prev => ({ ...prev, [connName]: { loading: false, ...test } }));
          if (data.snapshot) setSnapshot(data.snapshot);
        } catch (err) {
          if (!mountedRef.current) return;
          setConnTests(prev => ({
            ...prev,
            [connName]: { loading: false, ok: false, error: err?.message || t('errRequestFailed') },
          }));
        }
      }

      async function handleTestDraft() {
        const built = buildConnectionPayload(connDraft, t);
        if (built.error) {
          setFormError(built.error);
          return;
        }
        setFormError('');
        setDraftTest({ loading: true });
        setBusy('test-draft');
        try {
          const payload = { connection: built.connection };
          if (editingOriginalName) payload.originalName = editingOriginalName;
          if (connDraft.clearPassword) payload.clearPassword = true;
          const data = await apiRequest('testConnection', payload, currentLang);
          if (!mountedRef.current) return;
          const test = data.test || { ok: false, error: t('errRequestFailed') };
          setDraftTest({ loading: false, ...test });
          if (data.snapshot) setSnapshot(data.snapshot);
        } catch (err) {
          if (!mountedRef.current) return;
          setDraftTest({ loading: false, ok: false, error: err?.message || t('errRequestFailed') });
        } finally {
          if (mountedRef.current) setBusy('');
        }
      }

      async function handleSaveConnection(event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        if (!writable || !snapshot) return;
        const built = buildConnectionPayload(connDraft, t);
        if (built.error) {
          setFormError(built.error);
          return;
        }
        setFormError('');
        setError('');
        setErrorCode('');
        setNotice('');
        setBusy('save-conn');
        try {
          const payload = {
            connection: built.connection,
            revision: snapshot.revision,
          };
          if (editingOriginalName) payload.originalName = editingOriginalName;
          if (connDraft.clearPassword) payload.clearPassword = true;
          const data = await apiRequest('saveConnection', payload, currentLang);
          if (!mountedRef.current) return;
          if (data.snapshot) {
            setSnapshot(data.snapshot);
            if (!grDirty) {
              setGrDraft(guardrailsDraftFromSnapshot(data.snapshot.guardrails));
            }
          }
          setConnTests(prev => {
            const next = { ...prev };
            delete next[built.connection.name];
            if (editingOriginalName) delete next[editingOriginalName];
            return next;
          });
          closeForm();
          setNotice(t('noticeConnSaved'));
        } catch (err) {
          if (!mountedRef.current) return;
          if (err?.code === 'conflict') {
            setError(err.message);
            setErrorCode('conflict');
          } else {
            setFormError(err?.message || t('errRequestFailed'));
          }
        } finally {
          if (mountedRef.current) setBusy('');
        }
      }

      async function handleRemoveConnection(connName) {
        if (!writable || !snapshot) return;
        setError('');
        setErrorCode('');
        setNotice('');
        setBusy('remove-conn');
        try {
          const data = await apiRequest('removeConnection', {
            name: connName,
            revision: snapshot.revision,
          }, currentLang);
          if (!mountedRef.current) return;
          if (data.snapshot) {
            setSnapshot(data.snapshot);
            if (!grDirty) {
              setGrDraft(guardrailsDraftFromSnapshot(data.snapshot.guardrails));
            }
          }
          setConfirmDeleteName('');
          if (editingOriginalName === connName) closeForm();
          setConnTests(prev => {
            const next = { ...prev };
            delete next[connName];
            return next;
          });
          setNotice(t('noticeConnRemoved'));
        } catch (err) {
          if (!mountedRef.current) return;
          setError(err?.message || t('errRequestFailed'));
          setErrorCode(err?.code || '');
        } finally {
          if (mountedRef.current) setBusy('');
        }
      }

      async function handleSaveGuardrails(event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        if (!writable || !snapshot) return;
        const built = buildGuardrailsPayload(grDraft, snapshot.revision, t);
        if (built.error) {
          setGrError(built.error);
          return;
        }
        setGrError('');
        setError('');
        setErrorCode('');
        setNotice('');
        setBusy('save-guardrails');
        try {
          const data = await apiRequest('saveGuardrails', built.payload, currentLang);
          if (!mountedRef.current) return;
          if (data.snapshot) {
            setSnapshot(data.snapshot);
            setGrDraft(guardrailsDraftFromSnapshot(data.snapshot.guardrails));
          }
          setNotice(t('noticeGuardrailsSaved'));
        } catch (err) {
          if (!mountedRef.current) return;
          if (err?.code === 'conflict') {
            setError(err.message);
            setErrorCode('conflict');
          } else {
            setGrError(err?.message || t('errRequestFailed'));
          }
        } finally {
          if (mountedRef.current) setBusy('');
        }
      }

      function renderTestOutcome(state) {
        if (!state) return null;
        if (state.loading) {
          return h('div', { className: 'dsh-sql-test-result', role: 'status' }, t('btnTesting'));
        }
        if (state.ok) {
          const parts = ['✅ ' + t('testOk')];
          if (typeof state.durationMs === 'number') parts.push(state.durationMs + 'ms');
          if (typeof state.tableCount === 'number') {
            parts.push(
              state.tableCount === 1
                ? t('tableUnitOne')
                : state.tableCount + ' ' + t('tablesUnit')
            );
          }
          return h('div', { className: 'dsh-sql-test-result is-ok', role: 'status' }, parts.join(' · '));
        }
        const duration = typeof state.durationMs === 'number' ? ' (' + state.durationMs + 'ms)' : '';
        return h(
          'div',
          { className: 'dsh-sql-test-result is-err', role: 'alert' },
          '❌ ' + t('testFailed') + duration + (state.error ? '：' + state.error : '')
        );
      }

      function renderConnectionForm() {
        if (!formOpen) return null;
        const isSqlite = connDraft.engine === 'sqlite';
        const portPlaceholder = connDraft.engine === 'mysql' ? '3306' : '5432';
        const urlPlaceholder = isSqlite
          ? t('fieldUrlPlaceholderSqlite')
          : connDraft.engine === 'mysql'
            ? t('fieldUrlPlaceholderMysql')
            : t('fieldUrlPlaceholderPg');
        const showClearPassword = Boolean(editingOriginalName) && editingPasswordSource === 'config';
        const passwordPlaceholder = editingOriginalName
          ? (editingPasswordSource === 'config'
              ? t('pwdPlaceholderKeep')
              : editingPasswordSource === 'env'
                ? t('pwdPlaceholderEnv')
                : t('pwdPlaceholderNew'))
          : t('pwdPlaceholderNew');
        const envVarHint = passwordEnvName(connDraft.name);

        return h(
          'form',
          { className: 'dsh-sql-form-card', onSubmit: handleSaveConnection },
          h(
            'div',
            { className: 'dsh-sql-form-head' },
            h(
              'h4',
              { className: 'dsh-sql-form-title' },
              editingOriginalName ? t('formEditTitle') + ' · ' + editingOriginalName : t('formAddTitle')
            ),
            h(
              'button',
              { type: 'button', className: 'dsh-sql-btn is-sm', disabled: !!busy, onClick: closeForm },
              t('btnCancel')
            )
          ),
          formError
            ? h('div', { className: 'dsh-sql-banner is-error', role: 'alert' }, h('div', { className: 'dsh-sql-banner-body' }, formError))
            : null,
          h(
            'div',
            { className: 'dsh-sql-grid-2' },
            h(
              'label',
              { className: 'dsh-sql-field' },
              h('span', { className: 'dsh-sql-label' }, t('fieldName')),
              h('input', {
                type: 'text',
                className: 'dsh-sql-input',
                value: connDraft.name,
                placeholder: t('fieldNamePlaceholder'),
                disabled: !!busy,
                onChange: e => updateConnField('name', e.target.value),
              })
            ),
            h(
              'label',
              { className: 'dsh-sql-field' },
              h('span', { className: 'dsh-sql-label' }, t('fieldEngine')),
              h(
                'select',
                {
                  className: 'dsh-sql-select',
                  value: connDraft.engine,
                  disabled: !!busy,
                  onChange: e => updateConnField('engine', e.target.value),
                },
                h('option', { value: 'sqlite' }, 'SQLite'),
                h('option', { value: 'mysql' }, 'MySQL'),
                h('option', { value: 'postgres' }, 'PostgreSQL')
              )
            )
          ),
          h(
            'label',
            { className: 'dsh-sql-field' },
            h('span', { className: 'dsh-sql-label' }, t('fieldUrl')),
            h('input', {
              type: 'text',
              className: 'dsh-sql-input dsh-sql-mono',
              value: connDraft.url,
              placeholder: urlPlaceholder,
              disabled: !!busy,
              onChange: e => updateConnField('url', e.target.value),
            }),
            h('span', { className: 'dsh-sql-hint' }, t('fieldUrlHint'))
          ),
          isSqlite
            ? h(
                'label',
                { className: 'dsh-sql-field' },
                h('span', { className: 'dsh-sql-label' }, t('fieldFile')),
                h('input', {
                  type: 'text',
                  className: 'dsh-sql-input dsh-sql-mono',
                  value: connDraft.file,
                  placeholder: t('fieldFilePlaceholder'),
                  disabled: !!busy,
                  onChange: e => updateConnField('file', e.target.value),
                })
              )
            : h(
                React.Fragment,
                null,
                h(
                  'div',
                  { className: 'dsh-sql-grid-3' },
                  h(
                    'label',
                    { className: 'dsh-sql-field' },
                    h('span', { className: 'dsh-sql-label' }, t('fieldHost')),
                    h('input', {
                      type: 'text',
                      className: 'dsh-sql-input dsh-sql-mono',
                      value: connDraft.host,
                      placeholder: t('fieldHostPlaceholder'),
                      disabled: !!busy,
                      onChange: e => updateConnField('host', e.target.value),
                    })
                  ),
                  h(
                    'label',
                    { className: 'dsh-sql-field' },
                    h('span', { className: 'dsh-sql-label' }, t('fieldPort')),
                    h('input', {
                      type: 'number',
                      min: 1,
                      max: 65535,
                      step: 1,
                      className: 'dsh-sql-input dsh-sql-mono',
                      value: connDraft.port,
                      placeholder: portPlaceholder,
                      disabled: !!busy,
                      onChange: e => updateConnField('port', e.target.value),
                    })
                  ),
                  h(
                    'label',
                    { className: 'dsh-sql-field' },
                    h('span', { className: 'dsh-sql-label' }, t('fieldDatabase')),
                    h('input', {
                      type: 'text',
                      className: 'dsh-sql-input dsh-sql-mono',
                      value: connDraft.database,
                      placeholder: t('fieldDatabasePlaceholder'),
                      disabled: !!busy,
                      onChange: e => updateConnField('database', e.target.value),
                    })
                  )
                ),
                h(
                  'div',
                  { className: 'dsh-sql-grid-2' },
                  h(
                    'label',
                    { className: 'dsh-sql-field' },
                    h('span', { className: 'dsh-sql-label' }, t('fieldUser')),
                    h('input', {
                      type: 'text',
                      className: 'dsh-sql-input',
                      value: connDraft.user,
                      placeholder: t('fieldUserPlaceholder'),
                      autoComplete: 'username',
                      disabled: !!busy,
                      onChange: e => updateConnField('user', e.target.value),
                    })
                  ),
                  h(
                    'div',
                    { className: 'dsh-sql-field' },
                    h('label', { className: 'dsh-sql-label' }, t('fieldPassword')),
                    h('input', {
                      type: 'password',
                      className: 'dsh-sql-input',
                      value: connDraft.clearPassword ? '' : connDraft.password,
                      placeholder: passwordPlaceholder,
                      autoComplete: 'new-password',
                      disabled: !!busy || connDraft.clearPassword,
                      onChange: e => updateConnField('password', e.target.value),
                    }),
                    showClearPassword
                      ? h(
                          'label',
                          { className: 'dsh-sql-checkbox-row' },
                          h('input', {
                            type: 'checkbox',
                            checked: connDraft.clearPassword,
                            disabled: !!busy,
                            onChange: e => {
                              const checked = Boolean(e.target.checked);
                              setConnDraft(prev => ({
                                ...prev,
                                clearPassword: checked,
                                password: checked ? '' : prev.password,
                              }));
                            },
                          }),
                          h('span', null, t('clearPasswordLabel'))
                        )
                      : null,
                    h(
                      'span',
                      { className: 'dsh-sql-hint' },
                      t('pwdEnvHintPrefix') + ' ',
                      h('code', { className: 'dsh-sql-mono' }, envVarHint),
                      t('pwdEnvHintSuffix')
                    )
                  )
                ),
                h(
                  'label',
                  { className: 'dsh-sql-field' },
                  h('span', { className: 'dsh-sql-label' }, t('fieldSsl')),
                  h(
                    'select',
                    {
                      className: 'dsh-sql-select',
                      value: connDraft.sslMode,
                      disabled: !!busy,
                      onChange: e => updateConnField('sslMode', e.target.value),
                    },
                    h('option', { value: '' }, t('sslDefault')),
                    h('option', { value: 'disable' }, t('sslDisable')),
                    h('option', { value: 'allow' }, t('sslAllow')),
                    h('option', { value: 'prefer' }, t('sslPrefer')),
                    h('option', { value: 'require' }, t('sslRequire')),
                    h('option', { value: 'verify-ca' }, t('sslVerifyCa')),
                    h('option', { value: 'verify-full' }, t('sslVerifyFull')),
                    connDraft.sslMode === 'true' ? h('option', { value: 'true' }, t('sslTrue')) : null,
                    h('option', { value: 'custom' }, t('sslCustom'))
                  )
                ),
                connDraft.sslMode === 'custom'
                  ? h(
                      'div',
                      { className: 'dsh-sql-list' },
                      h(
                        'label',
                        { className: 'dsh-sql-checkbox-row' },
                        h('input', {
                          type: 'checkbox',
                          checked: connDraft.sslRejectUnauthorized,
                          disabled: !!busy,
                          onChange: e => updateConnField('sslRejectUnauthorized', Boolean(e.target.checked)),
                        }),
                        h('span', null, t('sslRejectUnauthorized'))
                      ),
                      h(
                        'label',
                        { className: 'dsh-sql-field' },
                        h('span', { className: 'dsh-sql-label' }, t('sslCaLabel')),
                        h('textarea', {
                          className: 'dsh-sql-textarea',
                          rows: 3,
                          value: connDraft.sslCa,
                          placeholder: t('sslCaPlaceholder'),
                          disabled: !!busy,
                          onChange: e => updateConnField('sslCa', e.target.value),
                        })
                      )
                    )
                  : null
              ),
          h(
            'label',
            { className: 'dsh-sql-checkbox-row' },
            h('input', {
              type: 'checkbox',
              checked: connDraft.readOnly,
              disabled: !!busy,
              onChange: e => updateConnField('readOnly', Boolean(e.target.checked)),
            }),
            h('span', null, t('fieldConnReadOnly'))
          ),
          renderTestOutcome(draftTest),
          h(
            'div',
            { className: 'dsh-sql-form-footer' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-sql-btn',
                disabled: !!busy,
                onClick: handleTestDraft,
              },
              busy === 'test-draft' ? t('btnTesting') : t('btnTestDraft')
            ),
            h(
              'div',
              { className: 'dsh-sql-actions' },
              h(
                'button',
                { type: 'button', className: 'dsh-sql-btn', disabled: !!busy, onClick: closeForm },
                t('btnCancel')
              ),
              h(
                'button',
                {
                  type: 'submit',
                  className: 'dsh-sql-btn is-primary',
                  disabled: !writable || !!busy,
                },
                busy === 'save-conn' ? t('btnSaving') : t('btnSaveConn')
              )
            )
          )
        );
      }

      function renderConnectionCard(conn) {
        const testState = connTests[conn.name];
        const sslBadge = formatSslBadge(conn.ssl);
        const isSyntheticDefault = Boolean(snapshot?.implicitMemoryDefault);
        const isDeleting = confirmDeleteName === conn.name;

        return h(
          'article',
          { key: conn.name, className: 'dsh-sql-conn-card' },
          h(
            'div',
            { className: 'dsh-sql-conn-top' },
            h(
              'div',
              { className: 'dsh-sql-conn-meta' },
              h(
                'div',
                { className: 'dsh-sql-conn-name-row' },
                h('strong', { className: 'dsh-sql-conn-name' }, conn.name),
                h('span', { className: 'dsh-sql-pill is-' + conn.engine }, engineLabel(conn.engine)),
                isSyntheticDefault ? h('span', { className: 'dsh-sql-pill is-warn' }, t('badgeMemory')) : null,
                conn.readOnly ? h('span', { className: 'dsh-sql-pill is-warn' }, t('badgeReadOnly')) : null,
                sslBadge ? h('span', { className: 'dsh-sql-pill is-ok' }, sslBadge) : null,
                conn.passwordSource === 'config'
                  ? h('span', { className: 'dsh-sql-pill' }, t('badgePwdSaved'))
                  : conn.passwordSource === 'env'
                    ? h('span', { className: 'dsh-sql-pill', title: conn.passwordEnvVar || passwordEnvName(conn.name) }, t('badgePwdEnv'))
                    : null
              ),
              h('div', { className: 'dsh-sql-conn-target' }, formatTarget(conn))
            ),
            h(
              'div',
              { className: 'dsh-sql-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-sql-btn is-sm',
                  disabled: Boolean(testState?.loading) || (busy !== '' && busy !== 'refresh'),
                  onClick: () => handleTestSaved(conn.name),
                },
                testState?.loading ? t('btnTesting') : t('btnTest')
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-sql-btn is-sm',
                  disabled: !writable || !!busy,
                  onClick: () => openEditForm(conn),
                },
                t('btnEdit')
              ),
              !isSyntheticDefault
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-sql-btn is-sm is-danger',
                      disabled: !writable || !!busy,
                      onClick: () => setConfirmDeleteName(isDeleting ? '' : conn.name),
                    },
                    t('btnDelete')
                  )
                : null
            )
          ),
          isDeleting
            ? h(
                'div',
                { className: 'dsh-sql-confirm-bar', role: 'alert' },
                h('span', null, t('deletePrompt') + ' “' + conn.name + '”?'),
                h(
                  'div',
                  { className: 'dsh-sql-actions' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-sql-btn is-sm',
                      disabled: !!busy,
                      onClick: () => setConfirmDeleteName(''),
                    },
                    t('btnCancel')
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-sql-btn is-sm is-danger-solid',
                      disabled: !writable || !!busy,
                      onClick: () => handleRemoveConnection(conn.name),
                    },
                    t('btnConfirmDelete')
                  )
                )
              )
            : null,
          renderTestOutcome(testState)
        );
      }

      const countBadge = connections.length === 1
        ? t('connectionCountOne')
        : connections.length + ' ' + t('connectionsCount');

      return h(
        'section',
        { className: 'dsh-sql-root', 'data-surface': surface },
        h(
          'header',
          { className: 'dsh-sql-header' },
          h(
            'div',
            { className: 'dsh-sql-header-text' },
            h('h2', { className: 'dsh-sql-title' }, t('pageTitle')),
            h('p', { className: 'dsh-sql-subtitle' }, t('pageSubtitle'))
          ),
          h(
            'div',
            { className: 'dsh-sql-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-sql-btn',
                disabled: busy === 'refresh',
                onClick: () => loadSnapshot({ resetGuardrails: true }),
              },
              busy === 'refresh' ? t('refreshing') : t('refresh')
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-sql-btn is-primary',
                disabled: !writable || !!busy,
                onClick: openAddForm,
              },
              '+ ' + t('addConnection')
            )
          )
        ),

        error
          ? h(
              'div',
              { className: 'dsh-sql-banner is-error', role: 'alert' },
              h('div', { className: 'dsh-sql-banner-body' }, error),
              h(
                'div',
                { className: 'dsh-sql-banner-actions' },
                errorCode === 'conflict' || !snapshot
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsh-sql-btn is-sm',
                        onClick: () => loadSnapshot({ resetGuardrails: !grDirty }),
                      },
                      t('retry')
                    )
                  : null,
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-sql-btn is-sm',
                    onClick: () => { setError(''); setErrorCode(''); },
                  },
                  t('dismiss')
                )
              )
            )
          : null,

        notice
          ? h(
              'div',
              { className: 'dsh-sql-banner is-success', role: 'status' },
              h('div', { className: 'dsh-sql-banner-body' }, notice),
              h(
                'button',
                { type: 'button', className: 'dsh-sql-btn is-sm', onClick: () => setNotice('') },
                t('dismiss')
              )
            )
          : null,

        snapshot && !writable
          ? h('div', { className: 'dsh-sql-banner is-warn', role: 'status' }, h('div', { className: 'dsh-sql-banner-body' }, t('readonlyBanner')))
          : null,

        snapshot && snapshot.implicitMemoryDefault
          ? h('div', { className: 'dsh-sql-banner is-info', role: 'status' }, h('div', { className: 'dsh-sql-banner-body' }, t('memoryBanner')))
          : null,

        loading && !snapshot
          ? h('div', { className: 'dsh-sql-loading', role: 'status' }, t('loading'))
          : snapshot
            ? h(
                React.Fragment,
                null,
                // Connections card
                h(
                  'div',
                  { className: 'dsh-sql-section' },
                  h(
                    'div',
                    { className: 'dsh-sql-section-head' },
                    h(
                      'h3',
                      { className: 'dsh-sql-section-title' },
                      t('connectionsHeading'),
                      h('span', { className: 'dsh-sql-count' }, countBadge)
                    ),
                    !formOpen
                      ? h(
                          'button',
                          {
                            type: 'button',
                            className: 'dsh-sql-btn is-sm',
                            disabled: !writable || !!busy,
                            onClick: openAddForm,
                          },
                          '+ ' + t('addConnection')
                        )
                      : null
                  ),
                  renderConnectionForm(),
                  connections.length > 0
                    ? h('div', { className: 'dsh-sql-list' }, connections.map(renderConnectionCard))
                    : h(
                        'div',
                        { className: 'dsh-sql-empty' },
                        h('p', { className: 'dsh-sql-empty-title' }, t('emptyTitle')),
                        h('p', { className: 'dsh-sql-empty-hint' }, t('emptyHint')),
                        !formOpen
                          ? h(
                              'button',
                              {
                                type: 'button',
                                className: 'dsh-sql-btn is-primary',
                                disabled: !writable || !!busy,
                                onClick: openAddForm,
                              },
                              '+ ' + t('addConnection')
                            )
                          : null
                      )
                ),

                // Safety Guardrails card
                h(
                  'form',
                  { className: 'dsh-sql-section', onSubmit: handleSaveGuardrails },
                  h(
                    'div',
                    { className: 'dsh-sql-section-head' },
                    h(
                      'div',
                      null,
                      h(
                        'h3',
                        { className: 'dsh-sql-section-title' },
                        t('guardrailsHeading'),
                        grDirty ? h('span', { className: 'dsh-sql-pill is-warn' }, t('unsavedBadge')) : null
                      ),
                      h('p', { className: 'dsh-sql-section-desc' }, t('guardrailsSubtitle'))
                    )
                  ),

                  grError
                    ? h('div', { className: 'dsh-sql-banner is-error', role: 'alert' }, h('div', { className: 'dsh-sql-banner-body' }, grError))
                    : null,

                  h(
                    'div',
                    { className: 'dsh-sql-toggle-row' },
                    h(
                      'div',
                      { className: 'dsh-sql-toggle-copy' },
                      h('div', { className: 'dsh-sql-toggle-title' }, t('grReadOnly')),
                      h('div', { className: 'dsh-sql-toggle-desc' }, t('grReadOnlyDesc'))
                    ),
                    h(
                      'label',
                      { className: 'dsh-sql-switch' },
                      h('input', {
                        type: 'checkbox',
                        role: 'switch',
                        'aria-label': t('grReadOnly'),
                        checked: grDraft.readOnly,
                        disabled: !writable || !!busy,
                        onChange: e => {
                          setGrError('');
                          setGrDraft(prev => ({ ...prev, readOnly: Boolean(e.target.checked) }));
                        },
                      }),
                      h('span', { className: 'dsh-sql-switch-track', 'aria-hidden': true })
                    )
                  ),

                  h(
                    'div',
                    { className: 'dsh-sql-toggle-row' },
                    h(
                      'div',
                      { className: 'dsh-sql-toggle-copy' },
                      h('div', { className: 'dsh-sql-toggle-title' }, t('grWriteApproval')),
                      h('div', { className: 'dsh-sql-toggle-desc' }, t('grWriteApprovalDesc'))
                    ),
                    h(
                      'label',
                      { className: 'dsh-sql-switch' },
                      h('input', {
                        type: 'checkbox',
                        role: 'switch',
                        'aria-label': t('grWriteApproval'),
                        checked: grDraft.writeApproval,
                        disabled: !writable || !!busy,
                        onChange: e => {
                          setGrError('');
                          setGrDraft(prev => ({ ...prev, writeApproval: Boolean(e.target.checked) }));
                        },
                      }),
                      h('span', { className: 'dsh-sql-switch-track', 'aria-hidden': true })
                    )
                  ),

                  !grDraft.readOnly && !grDraft.writeApproval
                    ? h('div', { className: 'dsh-sql-banner is-warn', role: 'status' }, h('div', { className: 'dsh-sql-banner-body' }, t('grWriteApprovalWarn')))
                    : null,

                  h(
                    'div',
                    { className: 'dsh-sql-grid-3' },
                    h(
                      'label',
                      { className: 'dsh-sql-field' },
                      h('span', { className: 'dsh-sql-label' }, t('grMaxRows')),
                      h('input', {
                        type: 'number',
                        min: 1,
                        max: 10000,
                        step: 1,
                        className: 'dsh-sql-input dsh-sql-mono',
                        value: grDraft.maxRows,
                        disabled: !writable || !!busy,
                        onChange: e => {
                          setGrError('');
                          setGrDraft(prev => ({ ...prev, maxRows: e.target.value }));
                        },
                      }),
                      h('span', { className: 'dsh-sql-hint' }, t('grMaxRowsHint'))
                    ),
                    h(
                      'label',
                      { className: 'dsh-sql-field' },
                      h('span', { className: 'dsh-sql-label' }, t('grQueryTimeout')),
                      h('input', {
                        type: 'number',
                        min: 5000,
                        max: 600000,
                        step: 1,
                        className: 'dsh-sql-input dsh-sql-mono',
                        value: grDraft.queryTimeoutMs,
                        disabled: !writable || !!busy,
                        onChange: e => {
                          setGrError('');
                          setGrDraft(prev => ({ ...prev, queryTimeoutMs: e.target.value }));
                        },
                      }),
                      h('span', { className: 'dsh-sql-hint' }, t('grQueryTimeoutHint'))
                    ),
                    h(
                      'label',
                      { className: 'dsh-sql-field' },
                      h('span', { className: 'dsh-sql-label' }, t('grExecTimeout')),
                      h('input', {
                        type: 'number',
                        min: 5000,
                        max: 600000,
                        step: 1,
                        className: 'dsh-sql-input dsh-sql-mono',
                        value: grDraft.execTimeoutMs,
                        disabled: !writable || !!busy,
                        onChange: e => {
                          setGrError('');
                          setGrDraft(prev => ({ ...prev, execTimeoutMs: e.target.value }));
                        },
                      }),
                      h('span', { className: 'dsh-sql-hint' }, t('grExecTimeoutHint'))
                    )
                  ),

                  h(
                    'label',
                    { className: 'dsh-sql-field' },
                    h('span', { className: 'dsh-sql-label' }, t('grRedactMode')),
                    h(
                      'select',
                      {
                        className: 'dsh-sql-select',
                        value: grDraft.redactMode,
                        disabled: !writable || !!busy,
                        onChange: e => {
                          setGrError('');
                          setGrDraft(prev => ({ ...prev, redactMode: e.target.value }));
                        },
                      },
                      h('option', { value: 'off' }, t('grRedactOff')),
                      h('option', { value: 'builtin' }, t('grRedactBuiltin')),
                      h('option', { value: 'custom' }, t('grRedactCustom'))
                    ),
                    grDraft.redactMode === 'builtin'
                      ? h(
                          'span',
                          { className: 'dsh-sql-hint' },
                          t('grRedactBuiltinHint'),
                          h('code', { className: 'dsh-sql-mono' }, BUILTIN_REDACT_PATTERNS.join(', '))
                        )
                      : null
                  ),

                  grDraft.redactMode === 'custom'
                    ? h(
                        'label',
                        { className: 'dsh-sql-field' },
                        h('span', { className: 'dsh-sql-label' }, t('grRedactCustomLabel')),
                        h('textarea', {
                          className: 'dsh-sql-textarea',
                          value: grDraft.redactText,
                          placeholder: t('grRedactCustomPlaceholder'),
                          disabled: !writable || !!busy,
                          onChange: e => {
                            setGrError('');
                            setGrDraft(prev => ({ ...prev, redactText: e.target.value }));
                          },
                        }),
                        h('span', { className: 'dsh-sql-hint' }, t('grRedactCustomHint'))
                      )
                    : null,

                  h(
                    'div',
                    { className: 'dsh-sql-form-footer' },
                    h('span', { className: 'dsh-sql-hint' }, ''),
                    h(
                      'div',
                      { className: 'dsh-sql-actions' },
                      grDirty
                        ? h(
                            'button',
                            {
                              type: 'button',
                              className: 'dsh-sql-btn',
                              disabled: !!busy,
                              onClick: () => {
                                setGrError('');
                                setGrDraft(guardrailsDraftFromSnapshot(snapshot.guardrails));
                              },
                            },
                            t('btnReset')
                          )
                        : null,
                      h(
                        'button',
                        {
                          type: 'submit',
                          className: 'dsh-sql-btn is-primary',
                          disabled: !writable || !!busy,
                        },
                        busy === 'save-guardrails' ? t('btnSaving') : t('btnSaveGuardrails')
                      )
                    )
                  )
                )
              )
            : null,

        surface !== 'bundle' && typeof __stardustUpdatesFooter === 'function'
          ? __stardustUpdatesFooter(React, 'dsh-sql')
          : null
      );
    }

    function SectionPanel(props) {
      return h(SqlSettingsPanel, { ...(props || {}), surface: 'section' });
    }

    function TabPanel(props) {
      return h(SqlSettingsPanel, { ...(props || {}), surface: 'tab' });
    }

    function BundleSummary() {
      const lang = useLocale();
      return h('span', { className: 'dsh-sql-summary' }, textFor('bundleSummary', lang));
    }

    function BundleConfigPanel(props) {
      if (props && props.view === 'summary') {
        return h(BundleSummary, null);
      }
      return h(SqlSettingsPanel, { ...(props || {}), surface: 'bundle' });
    }

    function apply(ctx) {
      if (ctx && typeof ctx.effect === 'function') {
        ctx.effect(() => {
          const service = (typeof ctx.get === 'function' ? ctx.get('locale') : null) || ctx.locale;
          const update = () => {
            currentLang = readLocale(ctx);
            for (const notify of langListeners) {
              try { notify(currentLang); } catch {}
            }
          };
          update();
          return (service && typeof service.subscribe === 'function' ? service.subscribe(update) : null) || (() => {});
        }, 'dsh-sql: locale');

        ctx.effect(() => {
          const style = ensureStyleInjected();
          return () => {
            if (style && typeof style.remove === 'function') {
              try { style.remove(); } catch {}
            }
          };
        }, 'dsh-sql: styles');
      } else {
        currentLang = readLocale(ctx);
      }

      const registerSlot = (slotName, registerFn) => {
        if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function' || typeof ctx.slots.register !== 'function') {
          return;
        }
        try {
          ctx.slots.inject(slotName, () => {
            try {
              return registerFn();
            } catch {
              return undefined;
            }
          });
        } catch {
          // Optional slot may not exist on older hosts.
        }
      };

      registerSlot('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-sql',
        order: 57,
        label: () => textFor('navTitle', readLocale(ctx)),
        inject: () => ({}),
      }, SectionPanel));

      registerSlot('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: 'dsh-sql',
        order: 57,
        label: () => textFor('tabTitle', readLocale(ctx)),
        inject: () => ({}),
      }, TabPanel));

      registerSlot('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: 'dsh-sql',
        inject: () => ({}),
      }, BundleConfigPanel));
    }

    return { apply, inject: ['slots', 'locale'] };
  },
});
