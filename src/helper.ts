import path from 'path'
import * as ts from 'typescript/lib/tsserverlibrary'
import { escapeRegExpChar } from './utils'
import { LibModule, LocalePlugin } from './plugin'
import { ServiceOptions } from './service'
import { Logger } from './logger'

type KeyDetail = {
  key: string
  text: string
  fileName: string
}

type KeyDetailWithPos = KeyDetail & {
  pos: number
}

export default class LanguageServiceHelper {
  private readonly typescript: typeof ts
  private readonly createInfo: ts.server.PluginCreateInfo
  private readonly plugin: LocalePlugin
  private readonly libModule: LibModule
  private readonly logger: Logger

  constructor(options: ServiceOptions) {
    this.typescript = options.typescript
    this.logger = options.logger
    this.plugin = options.plugin
    this.libModule = options.libModule
    this.createInfo = options.createInfo
  }

  getOriginalDefinitions(definitions: readonly ts.DefinitionInfo[]) {
    const firstDefs = definitions[0]
    if (
      firstDefs.kind === ts.ScriptElementKind.moduleElement &&
      this.plugin.isLocaleModule(firstDefs.fileName)
    ) {
      definitions = [
        {
          ...firstDefs,
          textSpan: { start: 0, length: 0 },
          originalFileName: firstDefs.fileName,
        },
      ]
    } else {
      const libDefinitions = this.getLibExportDefinitions(definitions)
      if (libDefinitions) {
        definitions = libDefinitions
      }
    }
    return definitions
  }

  getLibExportDefinitions(
    definitions: readonly ts.DefinitionInfo[]
  ): readonly ts.DefinitionInfo[] | undefined {
    const { languageService } = this.createInfo
    const libDts = this.libModule.declaration
    const program = languageService.getProgram()
    const libSourceFile = program?.getSourceFile(libDts)
    const symbol = (libSourceFile as any)?.symbol
    if (!libSourceFile || !symbol || !program) {
      return
    }

    const checker = program.getTypeChecker()
    for (const defs of definitions) {
      const { name, fileName } = defs
      if (this.plugin.isLocaleModule(fileName)) {
        const exportSymbol = checker.tryGetMemberInModuleExports(name, symbol)
        if (exportSymbol) {
          const exportDefinitions = languageService.getDefinitionAtPosition(
            libSourceFile.fileName,
            exportSymbol.declarations[0].pos + 1
          )
          if (exportDefinitions) {
            return exportDefinitions
          }
        }
        return
      }
    }
  }

  getTouchingStringLiteralNodeAtPosition(
    fileName: string,
    position: number
  ): ts.StringLiteral | undefined {
    const { languageService } = this.createInfo
    const { getTouchingPropertyName } = this.typescript as any
    const program = languageService.getProgram()
    if (!program || typeof getTouchingPropertyName !== 'function') {
      return
    }
    const sourceFile = program.getSourceFile(fileName)
    if (!sourceFile) {
      return
    }
    const node = getTouchingPropertyName.call(this.typescript, sourceFile, position)
    if (!node || node === sourceFile || node.kind !== ts.SyntaxKind.StringLiteral) {
      return
    }
    return node
  }

  getLocaleElementNodeAtStringLiteralNode(
    fileName: string,
    node: ts.StringLiteral
  ): ts.Node | undefined {
    const { languageService } = this.createInfo
    const program = languageService.getProgram()
    let { parent } = node
    if (!parent || !program) {
      return
    }
    const { name, kind, expression, elements, arguments: args } = parent as any

    if (kind === ts.SyntaxKind.ArrayLiteralExpression) {
      if (!elements || elements[0] !== node) {
        return
      }
      while ((parent = parent.parent)) {
        if (parent.kind === ts.SyntaxKind.CallExpression) {
          break
        }
      }
      if (!parent) {
        return
      }
      const { expression } = parent as any
      if (expression?.name?.escapedText !== 'apply') {
        return
      }
      return parent
    }

    if (kind === ts.SyntaxKind.CallExpression) {
      if (
        !args ||
        (args[0] !== node &&
          !(
            args[1] === node &&
            expression?.kind === ts.SyntaxKind.PropertyAccessExpression &&
            expression?.name?.escapedText === 'call'
          ))
      ) {
        return
      }
      return parent
    }

    if (kind == ts.SyntaxKind.JsxAttribute) {
      if (name?.escapedText !== 'id') {
        return
      }
      while ((parent = parent.parent)) {
        if (
          parent.kind === ts.SyntaxKind.JsxElement ||
          parent.kind === ts.SyntaxKind.JsxSelfClosingElement
        ) {
          return parent
        }
      }
    }
  }

  getLocaleElementSourceFileAtStringLiteralNode(
    fileName: string,
    node: ts.StringLiteral
  ): ts.SourceFile | undefined {
    const elementNode = this.getLocaleElementNodeAtStringLiteralNode(fileName, node)
    if (elementNode) {
      return this.getLocaleElementNodeSourceFileAtPosition(fileName, elementNode.pos + 1)
    }
  }

  getLocaleElementNodeSourceFileAtPosition(
    fileName: string,
    position: number
  ): ts.SourceFile | undefined {
    const { languageService } = this.createInfo
    const definition = this.getLocaleElementNodeTypeDefinitionAtPosition(fileName, position)
    if (!definition) {
      return
    }
    return languageService.getProgram()?.getSourceFile(definition.fileName)
  }

  getLocaleElementNodeTypeDefinitionAtPosition(
    fileName: string,
    position: number
  ): ts.DefinitionInfo | undefined {
    const { languageService } = this.createInfo
    const definition = languageService.getTypeDefinitionAtPosition(fileName, position)
    if (!definition) {
      return
    }
    for (const defs of definition) {
      const { kind, fileName } = defs
      if (
        (kind === ts.ScriptElementKind.functionElement ||
          kind === ts.ScriptElementKind.classElement) &&
        this.plugin.isLocaleModule(fileName)
      ) {
        return defs
      }
    }
  }

  getKeyDetailsAndBoundSpanAtPosition(
    fileName: string,
    position: number
  ): { textSpan: ts.TextSpan; details: KeyDetail[] } | undefined {
    const node = this.getTouchingStringLiteralNodeAtPosition(fileName, position)
    if (!node) {
      return
    }
    const sourceFile = this.getLocaleElementSourceFileAtStringLiteralNode(fileName, node)
    if (!sourceFile) {
      return
    }
    const details = this.getKeyDetailsFromSourceFile(node.text, sourceFile).reverse()
    if (!details.length) {
      return
    }
    return {
      details,
      textSpan: {
        start: node.pos,
        length: node.end - node.pos,
      },
    }
  }

  getDefinitionsFromKeyDetails(details: KeyDetail[]): readonly ts.DefinitionInfo[] {
    const definitions = [] as ts.DefinitionInfo[]
    const items = details.map((detail) => this.getKeyItemsFromKeyDetail(detail))
    for (const keyItems of items) {
      if (!keyItems) {
        continue
      }
      for (const { key, fileName, pos } of keyItems) {
        definitions.push({
          name: key,
          kind: ts.ScriptElementKind.string,
          containerKind: ts.ScriptElementKind.unknown,
          containerName: '',
          fileName: fileName,
          textSpan: { start: pos, length: key.length },
        })
      }
    }
    return definitions
  }

  getKeyDetailsFromSourceFile(
    key: string,
    sourceFile: ts.SourceFile,
    identifierName = 'Keys',
    pathMap: { [p: string]: any } = {}
  ): KeyDetail[] {
    const { statements, fileName } = sourceFile
    const details = [] as KeyDetail[]
    const imports = [] as typeof details
    if (pathMap[fileName]) {
      return details
    }
    pathMap[fileName] = 1
    if (!Array.isArray(statements)) {
      return details
    }
    const program = this.createInfo.languageService.getProgram()
    //
    for (const states of statements) {
      // main loop start
      if (states.kind === ts.SyntaxKind.ImportDeclaration) {
        // import start
        const { moduleSpecifier } = states as ts.ImportDeclaration
        const { text } = moduleSpecifier as ts.StringLiteral
        const importSourceFile = this.plugin.isLocaleModule(text)
          ? program?.getSourceFile(text)
          : null
        if (!importSourceFile) {
          continue
        }
        imports.push(
          ...this.getKeyDetailsFromSourceFile(key, importSourceFile, identifierName, pathMap)
        )
        // import end
      } else if (states.kind === ts.SyntaxKind.VariableStatement) {
        // variable start
        if (details.length) {
          continue
        }
        const { declarationList } = states as ts.VariableStatement
        for (const { name, initializer } of declarationList.declarations) {
          // declaration start
          if (
            !initializer ||
            initializer.kind !== ts.SyntaxKind.ObjectLiteralExpression ||
            name.kind !== ts.SyntaxKind.Identifier ||
            name.escapedText !== identifierName
          ) {
            continue
          }
          const { properties } = initializer as ts.ObjectLiteralExpression
          for (const prop of properties) {
            const { name, initializer } = prop as any
            if (name.text === key) {
              details.push({ key, text: initializer.text, fileName: sourceFile.fileName })
              break
            }
          }
          if (details.length) {
            break
          }
          // declaration end
        }
        // variable end
      }
      // main loop end
    }

    return [...imports, ...details]
  }

  getKeyItemsFromKeyDetail(detail: KeyDetail): KeyDetailWithPos[] | undefined {
    const { languageServiceHost } = this.createInfo
    const { key, text, fileName } = detail
    const snapshot = languageServiceHost.getScriptSnapshot(fileName)
    if (!snapshot) {
      this.logger.log(`There is no source file`)
      return
    }

    const items = []
    const values = (text.match(/[^\n]+|\n/g) || [])
      .filter((c) => c !== '\n')
      .map((c) => c.split(':').slice(1).join(':').trim())

    const source = snapshot.getText(0, snapshot.getLength())
    const regx = new RegExp(
      String.raw`^(\s*)(${escapeRegExpChar(key)}\s*:)(\s*$|\s[\s\S]+?$)`,
      'mg'
    )
    let matched

    while ((matched = regx.exec(source))) {
      const val = matched[3].trim()

      for (let i = 0; i < values.length; i++) {
        const value = values[i]
        if (value.startsWith(val)) {
          values.splice(i, 1)
          items.push({
            pos: matched.index + matched[1].length,
            text: value,
            fileName,
            key,
          })
          break
        }
      }

      if (!values.length) {
        break
      }
    }

    return items
  }

  createDisplayPart(text: string, kind: ts.SymbolDisplayPartKind) {
    const { displayPart } = this.typescript as any
    return typeof displayPart === 'function'
      ? displayPart(text, kind)
      : { text, kind: ts.SymbolDisplayPartKind[kind] }
  }

  createDisplayPartsFromKeyDetails({
    textSpan,
    details,
  }: {
    textSpan: ts.TextSpan
    details: KeyDetail[]
  }) {
    const context = this.createInfo.project.getCurrentDirectory()
    return {
      textSpan,
      kind: ts.ScriptElementKind.string,
      kindModifiers: ts.ScriptElementKindModifier.none,
      displayParts: details.reduce((parts, { text, fileName }) => {
        if (parts.length) {
          parts.push(
            this.createDisplayPart('\n', ts.SymbolDisplayPartKind.lineBreak),
            this.createDisplayPart('\n', ts.SymbolDisplayPartKind.lineBreak)
          )
        }
        for (const t of text.match(/[^\n]+|\n/g) || []) {
          if (t === '\n') {
            parts.push(this.createDisplayPart('\n', ts.SymbolDisplayPartKind.lineBreak))
          } else {
            const [loc, ...rest] = t.split(':')
            parts.push(
              this.createDisplayPart(loc, ts.SymbolDisplayPartKind.enumMemberName),
              this.createDisplayPart(':', ts.SymbolDisplayPartKind.punctuation),
              this.createDisplayPart(rest.join(':'), ts.SymbolDisplayPartKind.text)
            )
          }
        }
        parts.push(
          this.createDisplayPart('\n', ts.SymbolDisplayPartKind.lineBreak),
          this.createDisplayPart(
            path.relative(context, fileName).replace(/\\/g, '/'),
            ts.SymbolDisplayPartKind.text
          )
        )
        return parts
      }, [] as ts.SymbolDisplayPart[]),
    }
  }
}
