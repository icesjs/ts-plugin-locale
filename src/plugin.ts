import fs from 'fs'
import path from 'path'
import * as ts from 'typescript/lib/tsserverlibrary'
import { createLogger, Logger } from './logger'
import { getFilePath, isPluginContext } from './utils'
import createSnapshot from './snapshot'
import LanguageService from './service'

export type PluginOptions = {
  extensions?: string[]
  strict?: boolean
  lib?: LibType
  alias?: { [p: string]: string }
  [p: string]: any
}

type LibModule = {
  context: string
  packageInfo: { [p: string]: any }
  templateSource: string
}

enum LibType {
  react = 'react',
  vue = 'vue',
}

export class LocalePlugin implements ts.server.PluginModule {
  private options: PluginOptions = {}
  private logger: Logger | null = null
  private libModule: LibModule | null = null
  private createInfo: ts.server.PluginCreateInfo | null = null
  constructor(private readonly typescript: typeof ts) {}

  create(createInfo: ts.server.PluginCreateInfo): ts.LanguageService {
    const { project, config } = createInfo
    this.createInfo = createInfo
    this.logger = createLogger(createInfo)

    this.updateOptions(config)
    this.resolveLibModule(project.getCurrentDirectory())

    if (this.libModule) {
      this.createProxyForResolveModuleNames(createInfo.languageServiceHost)
      this.createProxyForCreateAndUpdateLanguageServiceSourceFile(this.typescript)
      return this.createLanguageServiceProxy(createInfo)
    }

    return createInfo.languageService
  }

  getExternalFiles(proj: ts.server.Project): string[] {
    const files = this.libModule ? proj.getFileNames().filter(this.isLocaleModule.bind(this)) : []
    this.logger?.log(`locale files: ${files.join(', ')}`)
    return files
  }

  onConfigurationChanged(config: any) {
    this.updateOptions(config)
  }

  createProxyForResolveModuleNames(serviceHost: ts.LanguageServiceHost) {
    const resolveModuleNames = serviceHost.resolveModuleNames!
    serviceHost.resolveModuleNames = this.createProxy(resolveModuleNames, {
      apply: (
        target: typeof resolveModuleNames,
        thisArg: any,
        [moduleNames, containingFile, ...rest]: Parameters<typeof resolveModuleNames>
      ) => {
        const resolvedModules = Reflect.apply(target, thisArg, [
          [...moduleNames],
          containingFile,
          ...rest,
        ])
        return resolvedModules.map((module: any, index: number) => {
          const fileName = moduleNames[index]
          if (!module && this.isLocaleModule(fileName)) {
            module = {
              extension: ts.Extension.Dts,
              isExternalLibraryImport: false,
              resolvedFileName: getFilePath(fileName, path.dirname(containingFile)),
            }
          }
          return module
        })
      },
    })
  }

  createLanguageServiceProxy(createInfo: ts.server.PluginCreateInfo) {
    const service = new LanguageService({
      plugin: this,
      logger: this.logger!,
      createInfo: createInfo,
      typescript: this.typescript,
    })
    return this.createProxy(createInfo.languageService, {
      get: (target: ts.LanguageService, prop: PropertyKey, receiver: any): any => {
        const value = Reflect.get(target, prop, receiver)
        if (typeof value !== 'function') {
          return value
        }
        return new Proxy(value, {
          apply: (method: any, thisArg: any, argArray?: any): any => {
            if (Reflect.getPrototypeOf(service).hasOwnProperty(prop)) {
              try {
                return Reflect.apply(Reflect.get(service, prop), service, argArray)
              } catch (err) {
                if (!/^Method not implemented/.test(err.message)) {
                  this.logger?.error(err)
                }
              }
            }
            return Reflect.apply(method, thisArg === receiver ? target : thisArg, argArray)
          },
        })
      },
    })
  }

  createProxyForCreateAndUpdateLanguageServiceSourceFile(typescript: typeof ts) {
    const { createLanguageServiceSourceFile, updateLanguageServiceSourceFile } = typescript

    const apply = (target: any, thisArg: any, [sourceFile, scriptSnapshot, ...rest]: any[]) => {
      const { strict, alias } = this.options
      const projectRoot = this.createInfo!.project.getCurrentDirectory()
      let fileName: string
      if (typeof sourceFile === 'string') {
        fileName = sourceFile
        sourceFile = null
      } else {
        fileName = sourceFile.fileName
      }

      sourceFile = Reflect.apply(target, thisArg, [
        sourceFile || fileName,
        this.isLocaleModule(fileName)
          ? createSnapshot(fileName, scriptSnapshot.getText(0, scriptSnapshot.getLength()), {
              alias,
              strict: strict!,
              logger: this.logger!,
              templateSource: this.libModule!.templateSource,
              context: projectRoot,
              tsResolveContext: this.getTsResolveContext(projectRoot),
            }) || scriptSnapshot
          : scriptSnapshot,
        ...rest,
      ])
      return sourceFile
    }

    typescript.createLanguageServiceSourceFile = this.createProxy(createLanguageServiceSourceFile, {
      apply,
    })
    typescript.updateLanguageServiceSourceFile = this.createProxy(updateLanguageServiceSourceFile, {
      apply,
    })
  }

  createProxy(target: any, handler: { [p: string]: any }) {
    const symbol = Symbol.for('proxy target')
    const originalTarget = target[symbol] || target
    const proxy = new Proxy(originalTarget, handler)
    Object.defineProperty(proxy, symbol, {
      value: target,
    })
    return proxy
  }

  resolveLibModule(context: string) {
    if (isPluginContext(context)) {
      return null
    }

    let lib
    let src
    switch (this.options.lib) {
      case LibType.vue:
        lib = '@ices/vue-locale'
        src = 'lib.vue.tsx'
        break
      case LibType.react:
      default:
        lib = '@ices/react-locale'
        src = 'lib.react.tsx'
    }

    try {
      const libPkgPath = require.resolve(`${lib}/package.json`, {
        paths: [context],
      })
      const libContext = path.dirname(libPkgPath)

      this.libModule = {
        context: libContext.toLowerCase(),
        packageInfo: require(libPkgPath),
        templateSource: fs.readFileSync(path.join(__dirname, '../lib', src), 'utf8'),
      }
    } catch (err) {
      this.logger!.log(`Can't resolve the lib module in ${context}`)
    }

    return null
  }

  updateOptions(config: any) {
    const { name, ...options } = Object.assign({}, config)
    const defaultExtensions = ['.yml', '.yaml']
    const { extensions, strict, lib, alias } = options as PluginOptions

    if (!Array.isArray(extensions)) {
      options.extensions = defaultExtensions
    }
    if (typeof strict !== 'boolean') {
      options.strict = true
    }
    if (typeof lib !== 'string') {
      options.lib = LibType.react
    }
    if (!alias || typeof alias !== 'object') {
      const compilerOptions = this.createInfo?.project?.getCompilerOptions()
      options.alias = compilerOptions?.paths
      options.baseUrl = compilerOptions?.baseUrl
    }

    this.options = options
  }

  isLocaleModule(fileName: string) {
    if (!fileName) {
      return false
    }
    for (const ext of this.options.extensions!) {
      if (fileName && fileName.toLowerCase().endsWith(ext.toLowerCase())) {
        return true
      }
    }
    return false
  }

  getTsResolveContext(root: string) {
    const { baseUrl } = this.options
    if (typeof baseUrl === 'string') {
      if (path.isAbsolute(baseUrl)) {
        return baseUrl
      }
      return path.join(root, baseUrl)
    }
    return root
  }
}
