import path from 'path'
import * as ts from 'typescript/lib/tsserverlibrary'

export interface Logger {
  log: (message: string) => void
  error: (error: Error) => void
}

export const createLogger = (info: ts.server.PluginCreateInfo): Logger => {
  const packageName = require(path.join(__dirname, '../package.json')).name as string
  const shortName = packageName.substr(packageName.indexOf('/') + 1)

  const log = (message: string) => {
    info.project.projectService.logger.info(`[${shortName}] ${message}`)
  }

  const error = (error: Error) => {
    log(`Failed ${error?.toString()}`)
    log(`Stack trace: ${error?.stack?.split(/\r?\n/).slice(0, 2).join('\n')}`)
  }

  return {
    log,
    error,
  }
}
