import path from 'path'

export function isSamePath(a?: string, b?: string) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false
  }
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
}

export function getFilePath(file: string, context: string) {
  if (!path.isAbsolute(file)) {
    file = path.join(context, file)
  }
  return file.replace(/\\/g, '/')
}

export function isPluginContext(context: string) {
  return isSamePath(context, getFilePath('..', __dirname))
}
