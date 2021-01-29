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

export function createProxy(target: any, handler: { [p: string]: any }) {
  const symbol = Symbol.for('locale plugin proxy target')
  let originalTarget = null
  for (const sym of Object.getOwnPropertySymbols(target)) {
    if (sym === symbol) {
      originalTarget = target[symbol]
      break
    }
  }
  const proxy = new Proxy(originalTarget || target, handler)
  if (!originalTarget) {
    Object.defineProperty(proxy, symbol, {
      value: target,
    })
  }
  return proxy
}

/*export function escapeRegExpChar(str: string) {
  return str.replace(/[|/\\{}()[\]^$+*?.]/g, '\\$&').replace(/-/g, '\\x2d')
}*/
