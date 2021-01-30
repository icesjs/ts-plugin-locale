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
  private readonly logger: Logger
  private readonly plugin: LocalePlugin

  constructor(options: ServiceOptions) {
    this.createInfo = options.createInfo
    this.logger = options.logger
    this.plugin = options.plugin
    this.serviceHelper = new LanguageServiceHelper(options)
  }

  getDefinitionAtPosition(
    fileName: string,
    position: number
  ): readonly ts.DefinitionInfo[] | undefined {
    this.logger.log(`getDefinitionAtPosition for ${fileName}:${position}`)
    const { languageService } = this.createInfo
    let definitions = languageService.getDefinitionAtPosition(fileName, position)
    if (!definitions || !definitions.length) {
      return definitions
    }
    return this.serviceHelper.getOriginalDefinitions(definitions)
  }

  getDefinitionAndBoundSpan(
    fileName: string,
    position: number
  ): ts.DefinitionInfoAndBoundSpan | undefined {
    this.logger.log(`getDefinitionAndBoundSpan for ${fileName}:${position}`)
    const { languageService } = this.createInfo
    let def = languageService.getDefinitionAndBoundSpan(fileName, position)
    if (!def?.definitions || !def.definitions.length) {
      const keyInfo = this.serviceHelper.getKeyDetailsAndBoundSpanAtPosition(fileName, position)
      if (keyInfo) {
        return {
          textSpan: keyInfo.textSpan,
          definitions: this.serviceHelper.getDefinitionsFromKeyDetails(keyInfo.details),
        }
      }
      return def
    }
    //
    def.definitions = this.serviceHelper.getOriginalDefinitions(def.definitions)
    return def
  }

  getQuickInfoAtPosition(fileName: string, position: number): ts.QuickInfo | undefined {
    this.logger.log(`getQuickInfoAtPosition for ${fileName}:${position}`)
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

  toLineColumnOffset(fileName: string, position: number): ts.LineAndCharacter {
    const { languageService, languageServiceHost } = this.createInfo
    if (this.plugin.isLocaleModule(fileName)) {
      const snapshot = languageServiceHost.getScriptSnapshot(fileName)
      if (snapshot) {
        const text = snapshot.getText(0, snapshot.getLength()) || ''
        const preText = text.substring(0, position)
        return {
          line: preText.split(/\n/).length - 1,
          character: position - preText.lastIndexOf('\n') - 1,
        }
      }
      return { line: 0, character: 0 }
    } else {
      const { toLineColumnOffset } = languageService
      return toLineColumnOffset
        ? toLineColumnOffset.call(languageService, fileName, position)
        : { line: 0, character: 0 }
    }
  }
}
