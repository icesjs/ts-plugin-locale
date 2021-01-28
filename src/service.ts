import path from 'path'
import * as ts from 'typescript/lib/tsserverlibrary'
import { Logger } from './logger'
import { LocalePlugin } from './plugin'

export type ServiceOptions = {
  typescript: typeof ts
  createInfo: ts.server.PluginCreateInfo
  logger: Logger
  plugin: LocalePlugin
}

// @ts-ignore
export default class LanguageService implements ts.LanguageService {
  private readonly typescript: typeof ts
  private readonly logger: Logger
  private readonly createInfo: ts.server.PluginCreateInfo
  private plugin: LocalePlugin

  constructor(options: ServiceOptions) {
    this.typescript = options.typescript
    this.plugin = options.plugin
    this.logger = options.logger
    this.createInfo = options.createInfo
  }

  getQuickInfoAtPosition(fileName: string, position: number): ts.QuickInfo | undefined {
    const { languageService } = this.createInfo
    const info = languageService.getQuickInfoAtPosition(fileName, position)
    if (info !== undefined) {
      return info
    }
    const node = this.getTouchingStringLiteralNodeAtPosition(fileName, position)
    if (!node) {
      return
    }
    const sourceFile = this.getLocaleSourceFileAtStringLiteralNode(fileName, node)
    if (!sourceFile) {
      return
    }
    const details = this.getMessageKeyDetailsFromBlock(node.text, sourceFile).reverse()
    if (!details.length) {
      return
    }
    this.logger.log(`get quick info: ${details}`)

    return this.formatDisplayParts(node, details)
  }

  getMessageKeyDetailsFromBlock(
    key: string,
    sourceFile: ts.SourceFile,
    identifierName = 'Keys',
    pathMap: { [p: string]: any } = {}
  ): { text: string; fileName: string }[] {
    const { statements, fileName } = sourceFile
    const details = [] as { text: string; fileName: string }[]
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
          ...this.getMessageKeyDetailsFromBlock(key, importSourceFile, identifierName, pathMap)
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
              details.push({ text: initializer.text, fileName: sourceFile.fileName })
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

  getTouchingStringLiteralNodeAtPosition(fileName: string, position: number) {
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
    const node = getTouchingPropertyName(sourceFile, position)
    if (!node || node === sourceFile || node.kind !== ts.SyntaxKind.StringLiteral) {
      return
    }
    return node
  }

  getLocaleSourceFileAtStringLiteralNode(fileName: string, node: ts.Node) {
    const { languageService } = this.createInfo
    const { parent } = node
    const program = languageService.getProgram()
    if (!parent || !program || parent.kind !== ts.SyntaxKind.CallExpression) {
      return
    }
    const definition = languageService.getDefinitionAtPosition(fileName, parent.pos + 1)
    if (!definition) {
      return
    }
    const localeDefinition = definition.find(
      (def) =>
        def.kind === ts.ScriptElementKind.functionElement &&
        this.plugin.isLocaleModule(def.fileName)
    )
    if (!localeDefinition) {
      return
    }
    return program.getSourceFile(localeDefinition.fileName)
  }

  displayPart(text: string, kind: ts.SymbolDisplayPartKind) {
    const { displayPart } = this.typescript as any
    return typeof displayPart === 'function'
      ? displayPart(text, kind)
      : { text, kind: ts.SymbolDisplayPartKind[kind] }
  }

  formatDisplayParts(node: ts.Node, details: { text: string; fileName: string }[]) {
    const context = this.createInfo.project.getCurrentDirectory()
    return {
      kind: ts.ScriptElementKind.string,
      kindModifiers: ts.ScriptElementKindModifier.none,
      textSpan: { start: node.pos, length: node.end - node.pos },
      displayParts: details.reduce((parts, { text, fileName }) => {
        if (parts.length) {
          parts.push(
            this.displayPart('\n', ts.SymbolDisplayPartKind.lineBreak),
            this.displayPart('\n', ts.SymbolDisplayPartKind.lineBreak)
          )
        }
        for (const t of text.match(/[^\n]+|\n/g) || []) {
          if (t === '\n') {
            parts.push(this.displayPart('\n', ts.SymbolDisplayPartKind.lineBreak))
          } else {
            const [loc, ...rest] = t.split(':')
            parts.push(
              this.displayPart(loc, ts.SymbolDisplayPartKind.enumMemberName),
              this.displayPart(':', ts.SymbolDisplayPartKind.punctuation),
              this.displayPart(rest.join(':'), ts.SymbolDisplayPartKind.text)
            )
          }
        }
        parts.push(
          this.displayPart('\n', ts.SymbolDisplayPartKind.lineBreak),
          this.displayPart(
            path.relative(context, fileName).replace(/\\/g, '/'),
            ts.SymbolDisplayPartKind.text
          )
        )
        return parts
      }, [] as ts.SymbolDisplayPart[]),
    }
  }
}
