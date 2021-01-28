import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'

const directiveRegx = /^\s*#include(?=[<'"\s](?!['"<>.\\/\s;]*$))\s*(?:(['"]?)\s*([^'"<>:*?|]+?)\s*\1|<(?!\s*(?:\.*[/\\]|\.{2,}))\s*([^'"<>:*?|]+?)\s*>)[\s;]*$/gm
const resolveExtensions = ['.yml', '.yaml']

export type FileNodeType = {
  context: string
  exists: boolean
  file: string
  source: string
  isDir: boolean
}

function readFileSync(fileName: string): FileNodeType {
  const fileNode = {
    file: fileName,
    context: path.dirname(fileName),
    source: '',
    exists: false,
    isDir: false,
  }
  try {
    const stats = fs.statSync(fileName)
    if (stats.isSymbolicLink()) {
      const realPath = fs.realpathSync(fileName)
      if (realPath !== fileName) {
        return readFileSync(realPath)
      }
    }
    fileNode.isDir = stats.isDirectory()
    fileNode.exists = true
  } catch (e) {
    fileNode.exists = false
  }
  return fileNode
}

function resolveFile(fileName: string) {
  const fileNode = readFileSync(fileName)
  const { file, isDir, exists } = fileNode
  if (isDir) {
    for (const ext of resolveExtensions) {
      const indexFileNode = readFileSync(path.join(file, `index${ext}`))
      const { exists, isDir } = indexFileNode
      if (exists && !isDir) {
        return indexFileNode
      }
    }
  } else if (!exists) {
    const extName = path.extname(file)
    for (const ext of resolveExtensions) {
      if (ext === extName) {
        continue
      }
      const extFileNode = readFileSync(file + ext)
      const { exists, isDir } = extFileNode
      if (exists && !isDir) {
        return extFileNode
      }
    }
  }
  return fileNode
}

function resolveTsPaths(filePath: string, alias: string, paths: any[], context: string) {
  for (const p of paths) {
    if (typeof p !== 'string' || /^\s*$/.test(p)) {
      continue
    }
    const to = p.trim()
    let aliasFile = ''
    if (filePath === alias) {
      if (!/\*/.test(to)) {
        aliasFile = to
      }
    } else if (alias.endsWith('/*')) {
      if (filePath.startsWith(alias.substr(0, alias.length - 1))) {
        if (to.endsWith('/*')) {
          aliasFile = to.substr(0, to.length - 1) + filePath.substr(alias.length - 1)
        } else if (!/\*/.test(to)) {
          aliasFile = to
        }
      }
    }
    if (aliasFile) {
      if (!path.isAbsolute(aliasFile)) {
        aliasFile = path.join(context, aliasFile)
      }
      const { file, exists, isDir } = resolveFile(aliasFile)
      if (exists && !isDir) {
        return file
      }
    }
  }
}

function resolvePath(
  filePath: string,
  resolveAlias: any,
  context: string,
  tsResolveContext: string
): string {
  let aliasFile = ''
  for (let [alias, val] of Object.entries(resolveAlias || {})) {
    if (Array.isArray(val)) {
      const resolved = resolveTsPaths(filePath, alias, val, tsResolveContext)
      if (resolved) {
        return resolved
      }
      continue
    }
    if (typeof val !== 'string' || /^\s*$/.test(val)) {
      continue
    }
    const to = val.trim()
    if (alias.endsWith('$')) {
      if (filePath === alias.substr(0, alias.length - 1)) {
        aliasFile = to
      }
    } else if (filePath.startsWith(`${alias}/`)) {
      aliasFile = path.join(to, filePath.substr(alias.length + 1))
    }
    if (aliasFile) {
      break
    }
  }

  if (aliasFile) {
    if (path.isAbsolute(aliasFile)) {
      filePath = aliasFile
    } else {
      filePath = path.join(context, aliasFile)
    }
  } else {
    filePath = path.join(context, filePath)
  }
  return filePath
}

export function parseKeys(source: string, fileName: string) {
  let data
  try {
    data = yaml.load(source, {
      json: true,
      onWarning: () => {},
    })
  } catch (err) {
    data = {}
  }
  const keys = {} as { [p: string]: any }
  for (const [key, obj] of Object.entries(data || {})) {
    if (obj !== null && typeof obj !== 'object') {
      if (!keys[key]) {
        keys[key] = []
      }
      keys[key].push(
        `${path.basename(fileName).replace(/\.[^.]*$/, '')} : ${`${obj}`.replace(
          /[\r\n]/g,
          '\\$&'
        )}`
      )
    } else if (obj !== null) {
      for (const [k, val] of Object.entries(obj)) {
        if (val !== null && typeof val !== 'object') {
          if (!keys[k]) {
            keys[k] = []
          }
          keys[k].push(`${key} : ${`${val}`.replace(/[\r\n]/g, '\\$&')}`)
        }
      }
    }
  }
  return Object.entries(keys).reduce((keys, [key, arr]) => {
    keys[key] = arr.join('\n')
    return keys
  }, {} as { [p: string]: string })
}

export function parseInclude(
  fileNode: FileNodeType,
  currentProject: string,
  tsResolveContext: string,
  resolveAlias?: any
) {
  const { context, source } = fileNode
  const includes = new Set<string>()
  const parsed = {} as { [p: string]: FileNodeType }

  let matched
  while ((matched = directiveRegx.exec(source))) {
    const [, , contextPath, modulePath] = matched
    const includePath = contextPath
      ? resolvePath(contextPath, resolveAlias, context, tsResolveContext)
      : resolvePath(
          modulePath,
          resolveAlias,
          path.join(currentProject, 'node_modules'),
          tsResolveContext
        )

    const resolved = parsed[includePath] || resolveFile(includePath)
    const { file, exists, isDir } = resolved

    parsed[includePath] = resolved
    parsed[file] = resolved

    if (exists && !isDir) {
      includes.add(file)
    }
  }

  return [...includes]
}

export default function parse({
  fileName,
  source,
  projectRoot,
  resolveAlias,
  tsResolveContext,
}: {
  fileName: string
  source: string
  projectRoot: string
  resolveAlias: any
  tsResolveContext: string
}) {
  const fileNode = readFileSync(fileName)
  fileNode.source = source || ''
  return {
    includes: parseInclude(fileNode, projectRoot, tsResolveContext, resolveAlias),
    keys: parseKeys(fileNode.source, fileNode.file),
  }
}
