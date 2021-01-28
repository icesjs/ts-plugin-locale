import * as ts from 'typescript/lib/tsserverlibrary'
import { LocalePlugin } from './plugin'

function init(modules: { typescript: typeof ts }) {
  const { typescript } = modules
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
