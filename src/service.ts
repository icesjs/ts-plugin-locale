import * as ts from 'typescript/lib/tsserverlibrary'
import { Logger } from './logger'
import { LocalePlugin, LibModule } from './plugin'
import LanguageServiceHelper from './helper'

export type ServiceOptions = {
  typescript: typeof ts
  createInfo: ts.server.PluginCreateInfo
  logger: Logger
  plugin: LocalePlugin
  libModule: LibModule
}

// @ts-ignore
export default class LanguageService implements ts.LanguageService {
  private readonly createInfo: ts.server.PluginCreateInfo
  private readonly serviceHelper: LanguageServiceHelper
  private readonly plugin: LocalePlugin
  private readonly libModule: LibModule

  constructor(options: ServiceOptions) {
    this.createInfo = options.createInfo
    this.plugin = options.plugin
    this.libModule = options.libModule
    this.serviceHelper = new LanguageServiceHelper(options)
  }

  getDefinitionAndBoundSpan(
    fileName: string,
    position: number
  ): ts.DefinitionInfoAndBoundSpan | undefined {
    const { languageService } = this.createInfo
    const def = languageService.getDefinitionAndBoundSpan(fileName, position)
    if (!def?.definitions) {
      return def
    }

    const libDts = this.libModule.declaration
    const program = languageService.getProgram()
    const libSourceFile = program?.getSourceFile(libDts)
    const symbol = (libSourceFile as any)?.symbol
    if (!libSourceFile || !symbol || !program) {
      return def
    }

    const checker = program.getTypeChecker()
    for (const { name, fileName } of def.definitions) {
      if (this.plugin.isLocaleModule(fileName)) {
        const exportSymbol = checker.tryGetMemberInModuleExports(name, symbol)
        if (exportSymbol) {
          const definitions = languageService.getDefinitionAtPosition(
            libSourceFile.fileName,
            exportSymbol.declarations[0].pos + 1
          )
          if (definitions) {
            return {
              textSpan: def.textSpan,
              definitions,
            }
          }
        }
        return
      }
    }

    return def
  }

  getQuickInfoAtPosition(fileName: string, position: number): ts.QuickInfo | undefined {
    const { languageService } = this.createInfo
    const info = languageService.getQuickInfoAtPosition(fileName, position)
    if (info !== undefined) {
      return info
    }
    const res = this.serviceHelper.getKeyDetailsAndBoundSpanAtPosition(fileName, position)
    if (res) {
      return this.serviceHelper.createDisplayPartsFromKeyDetails(res)
    }
  }
}
