import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'templates/client.js'), 'utf8').replace(/\r\n/g, '\n')
const output = '// Generated from templates/client.js. Edit the source template.\n' + source

mkdirSync(join(root, 'lib'), { recursive: true })
rmSync(join(root, 'lib/update-client.js'), { force: true })
writeFileSync(join(root, 'lib/client.js'), output, 'utf8')
