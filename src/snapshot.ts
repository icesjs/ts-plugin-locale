import * as ts from 'typescript/lib/tsserverlibrary'
import { Logger } from './logger'
import parse from './parser'

function createSnapshot(
  fileName: string,
  source: string,
  options: {
    strict: boolean
    context: string
    tsResolveContext: string
    logger: Logger
    templateSource: string
    alias: any
  }
) {
  const { strict, alias, context, logger, templateSource, tsResolveContext } = options
  let includes
  let keys
  try {
    ;({ includes, keys } = parse({
      fileName,
      source,
      projectRoot: context,
      tsResolveContext,
      resolveAlias: alias,
    }))
  } catch (err) {
    logger.error(err)
    return null
  }

  const importedKeysType = [`// ${fileName}\n`]
  const exportedKeysType = ['keyof typeof Keys']

  includes.forEach((inc, index) => {
    const ident = `KeysType${index}`
    importedKeysType.push(
      `import type { MessageKeys as ${ident} } from ${JSON.stringify(inc.replace(/\\/g, '/'))}`
    )
    exportedKeysType.push(ident)
  })
  importedKeysType.push('\n')
  importedKeysType.push(`const Keys = ${JSON.stringify(keys)}`)

  if (!strict) {
    exportedKeysType.push('string')
  }

  const imports = importedKeysType.join('\n')
  const exports = `type MessageKeys = ${exportedKeysType.join(' | ')}`
  let snapshot
  try {
    snapshot = ts.ScriptSnapshot.fromString(
      templateSource
        .replace(/^const\s+Keys\s*=.+$/m, imports + '\n')
        .replace(/^type\s+MessageKeys\s*=.+$/m, exports + '\n')
    )
  } catch (err) {
    snapshot = null
    logger.error(err)
  }

  return snapshot
}

export default createSnapshot
