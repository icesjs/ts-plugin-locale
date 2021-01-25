import fs from 'fs'
import path from 'path'
import * as ts from 'typescript/lib/tsserverlibrary'
import { createLogger, Logger } from './logger'

type LibModule = {
  pkg: string
  dts: string
  context: string
  libDts: string
}

interface PluginOptions {
  extensions?: string[]
  localesDir?: string
  manifest?: string
  strict?: boolean
  lib?: LibType
}

enum LibType {
  react = 'react',
  vue = 'vue',
}

const pluginName = 'LocalePlugin'

class LocalePlugin implements ts.server.PluginModule {
  constructor(private readonly typescript: typeof ts) {}
  private logger: Logger | null = null
  private options: PluginOptions | null = null
  private createInfo: ts.server.PluginCreateInfo | null = null
  private libModule: LibModule | null = null
  private dts: string = ''

  setPluginOptions(config: any) {
    const defaultExtensions = ['.yml', '.yaml']
    const defaultLocalesDir = 'src/.locales'
    const defaultManifest = 'node_modules/.locale-plugin/manifest.json'
    const options = Object.assign({}, config)
    if (!Array.isArray(options.extensions)) {
      if (options.extensions) {
        this.logger!.error(new Error('Config of extensions must be an array'))
      }
      options.extensions = defaultExtensions
    }
    if (typeof options.localesDir !== 'string') {
      options.localesDir = defaultLocalesDir
    }
    if (typeof options.manifest !== 'string') {
      options.manifest = defaultManifest
    }
    if (typeof options.strict !== 'boolean') {
      options.strict = true
    }
    this.options = options
  }

  create(info: ts.server.PluginCreateInfo): ts.LanguageService {
    this.createInfo = info
    this.logger = createLogger(info)
    this.setPluginOptions(info.config.options)
    this.libModule = this.resolveLibModule(this.getProjectDirectory())

    if (this.libModule) {
      this.dts = fs.readFileSync(path.join(__dirname, '../types', this.libModule.dts), 'utf8')

      this.proxyResolveModuleName()
      this.proxyCreateLanguageServiceSourceFile()
      this.proxyUpdateLanguageServiceSourceFile()
    } else {
      this.logger.log('Can not found the library for locales module')
    }

    return info.languageService
  }

  getExternalFiles(proj: ts.server.Project): string[] {
    return this.libModule ? proj.getFileNames().filter((file) => this.isLocaleFile(file)) : []
  }

  getProjectDirectory() {
    return this.createInfo!.project.getCurrentDirectory()
  }

  onConfigurationChanged(config: any) {
    if (this.libModule) {
      this.setPluginOptions(config)
    }
  }

  resolveLibModule(context: string) {
    if (context.toLowerCase() === this.getFilePath('..', __dirname).toLowerCase()) {
      return null
    }

    let lib
    let dts
    switch (this.options!.lib) {
      case LibType.vue:
        lib = '@ices/vue-locale'
        dts = 'lib.vue.d.ts'
        break
      case LibType.react:
      default:
        lib = '@ices/react-locale'
        dts = 'lib.react.d.ts'
    }

    try {
      const libPkgPath = require.resolve(`${lib}/package.json`, {
        paths: [context],
      })
      const libContext = path.dirname(libPkgPath)
      return {
        dts,
        pkg: require(libPkgPath),
        context: libContext,
        libDts: path.join(libContext, 'lib/locale.d.ts').replace(/\\/g, '/'),
      }
    } catch (err) {
      this.logger?.log(err.message)
      return null
    }
  }

  isLocaleFile(file: string) {
    for (const ext of this.options!.extensions!) {
      if (file && file.toLowerCase().endsWith(ext.toLowerCase())) {
        return true
      }
    }
    return false
  }

  getFilePath(file: string, context: string) {
    if (!path.isAbsolute(file)) {
      file = path.join(context, file)
    }
    return file.replace(/\\/g, '/')
  }

  proxyResolveModuleName() {
    const { languageServiceHost } = this.createInfo!
    const { resolveModuleNames } = languageServiceHost
    if (typeof resolveModuleNames === 'function') {
      languageServiceHost.resolveModuleNames = this.createProxy(resolveModuleNames, {
        apply: (
          target: typeof resolveModuleNames,
          thisArg: any,
          [names, containingFile, ...rest]: any
        ): any => {
          const moduleNames = [...names]
          const resolvedModules = Reflect.apply(target, thisArg, [
            names,
            containingFile,
            ...rest,
          ]) as ReturnType<typeof resolveModuleNames>
          return moduleNames.map((module: string, index: number) => {
            if (module && this.isLocaleFile(module)) {
              return {
                extension: ts.Extension.Dts,
                isExternalLibraryImport: false,
                resolvedFileName: this.getFilePath(module, path.dirname(containingFile)),
              }
            }
            return resolvedModules[index]
          })
        },
      })
    }
  }

  proxyCreateLanguageServiceSourceFile() {
    const { createLanguageServiceSourceFile } = this.typescript
    this.typescript.createLanguageServiceSourceFile = this.createProxy(
      createLanguageServiceSourceFile,
      {
        apply: (
          target: typeof createLanguageServiceSourceFile,
          thisArg: any,
          [fileName, snapshot, ...rest]: any
        ): any => {
          let isDeclarationFile = false
          if (this.isLocaleFile(fileName)) {
            snapshot = this.createDeclarationSnapshot(fileName, snapshot)
            isDeclarationFile = true
          }
          const sourceFile = Reflect.apply(target, thisArg, [fileName, snapshot, ...rest])
          if (isDeclarationFile) {
            sourceFile.isDeclarationFile = true
          }
          return sourceFile
        },
      }
    )
  }

  proxyUpdateLanguageServiceSourceFile() {
    const { updateLanguageServiceSourceFile } = this.typescript
    this.typescript.updateLanguageServiceSourceFile = this.createProxy(
      updateLanguageServiceSourceFile,
      {
        apply: (
          target: typeof updateLanguageServiceSourceFile,
          thisArg: any,
          [sourceFile, snapshot, ...rest]: any
        ): any => {
          let isDeclarationFile = false
          if (this.isLocaleFile(sourceFile.fileName)) {
            snapshot = this.createDeclarationSnapshot(sourceFile.fileName, snapshot)
            isDeclarationFile = true
          }
          sourceFile = Reflect.apply(target, thisArg, [sourceFile, snapshot, ...rest])
          if (isDeclarationFile) {
            sourceFile.isDeclarationFile = true
          }
          return sourceFile
        },
      }
    )
  }

  createDeclarationSnapshot(fileName: string, scriptSnapshot: ts.IScriptSnapshot) {
    const cwd = this.getProjectDirectory()
    const { localesDir, manifest, strict } = this.options!
    const resourceDir = this.getFilePath(localesDir!, cwd)
    const manifestPath = this.getFilePath(manifest!, cwd)
    let snapshot
    try {
      if (fs.existsSync(manifestPath) && fs.statSync(manifestPath).isFile()) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
        const id = this.getModuleId(fileName, manifest)
        if (
          typeof id !== 'undefined' &&
          fs.existsSync(resourceDir) &&
          fs.statSync(resourceDir).isDirectory()
        ) {
          const locales = []
          for (const file of fs.readdirSync(resourceDir)) {
            if (file.endsWith('.json')) {
              locales.push(fs.readFileSync(path.join(resourceDir, file), 'utf8'))
            }
          }
          const keys = this.parseKeys(fileName, locales, id).map((k) => JSON.stringify(k))
          if (!strict || !keys.length) {
            keys.push('string')
          }
          snapshot = ts.ScriptSnapshot.fromString(
            this.dts.replace(/\btype\s+Keys\s*=[^;\r\n]+/, `type Keys = ${keys.join('|')}`)
          )
        }
      }
    } catch (err) {
      this.logger!.error(err)
    }
    return snapshot || scriptSnapshot
  }

  parseKeys(fileName: string, locales: string[], id: any) {
    const dataSet = new Set<string>()
    for (const locale of locales) {
      const data = JSON.parse(locale) || {}
      const encodedData = data[id]
      if (encodedData && typeof encodedData === 'object' && Array.isArray(data.k)) {
        for (const key of Object.keys(encodedData)) {
          dataSet.add(data.k[key])
        }
      }
    }
    return [...dataSet].sort()
  }

  getModuleId(fileName: string, manifest: { [p: string]: any }) {
    const file = fileName.replace(/\\/g, '/').toLowerCase()
    for (const [path, id] of Object.entries(manifest || {})) {
      if (path.replace(/\\/g, '/').toLowerCase() === file) {
        return id
      }
    }
  }

  createProxy(target: any, handler: { [p: string]: any }) {
    if (target.__proxiedBy === pluginName) {
      return target
    }
    const proxy = new Proxy(target, handler)
    proxy.__proxiedBy = pluginName
    return proxy
  }
}

function init({ typescript }: { typescript: typeof ts }) {
  return new Proxy(new LocalePlugin(typescript), {
    get(target: LocalePlugin, prop: PropertyKey, receiver: any): any {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value === 'function') {
        return value.bind(target)
      }
      return value
    },
  })
}

export = init
