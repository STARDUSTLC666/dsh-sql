/** Private IPC entry point. Never execute DatabaseSync in the host's event loop. */
import { SqliteEngine } from './sqlite-engine.js';
let engine;
process.on('disconnect', () => { void engine?.close().finally(() => process.exit(0)); });
process.on('message', async (message) => {
    if (message?.type === 'close') {
        try {
            await engine?.close();
        }
        finally {
            process.exit(0);
        }
    }
    if (message?.type !== 'request')
        return;
    try {
        if (!engine) {
            engine = new SqliteEngine(message.file, message.readOnly);
            process.send?.({ type: 'ready' });
        }
        const args = message.args;
        let value;
        switch (message.method) {
            case 'query':
                value = await engine.query(args[0], args[1], undefined, args[2]);
                break;
            case 'exec':
                value = await engine.exec(args[0], undefined, args[1]);
                break;
            case 'listTables':
                value = await engine.listTables(undefined, args[0]);
                break;
            case 'describeTable':
                value = await engine.describeTable(args[0]);
                break;
            case 'describeTableDetail':
                value = await engine.describeTableDetail(args[0]);
                break;
            case 'ping':
                value = await engine.ping();
                break;
            default: throw new Error('Unknown SQLite operation');
        }
        process.send?.({ type: 'result', id: message.id, value });
    }
    catch (error) {
        const detail = error;
        process.send?.({ type: 'result', id: message.id, error: {
                message: detail.message ?? String(error), name: detail.name, code: detail.code,
                errcode: detail.errcode, errstr: detail.errstr,
            } });
    }
});
