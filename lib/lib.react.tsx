const Keys = {} // Keys 的值被替换成已解析的数据
type MessageKeys = keyof typeof Keys // MessageKeys 被替换成已解析的类型

import {
  setLocale,
  Trans as TransComponent,
  useTrans as useTransHook,
  useContextTrans as useContextTransHook,
  PluginFunction,
} from '@ices/react-locale'
export * from '@ices/react-locale'

export { MessageKeys }
type ValidMessageKeys = MessageKeys extends never ? string : MessageKeys
type TransComponentProps = Omit<ConstructorParameters<typeof TransComponent>[0], 'id'>
type TransPropsWithKeys = { id: ValidMessageKeys } & TransComponentProps
type UseTransReturnType = [ReturnType<typeof wrapTransFunc>, string, typeof setLocale]

const wrapTransFunc = (trans: ReturnType<typeof useTransHook>[0]) => {
  return (key: ValidMessageKeys, ...pluginArgs: any[]) => trans(key, ...pluginArgs)
}

const useTransWithKeys = (...args: Parameters<typeof useTransHook>) => {
  const [trans, ...rest] = useTransHook(...args)
  const wrapTrans = wrapTransFunc(trans)
  return [wrapTrans, ...rest] as UseTransReturnType
}

const useContextTransWithKeys = (...args: Parameters<typeof useContextTransHook>) => {
  const [trans, ...rest] = useContextTransHook(...args)
  const wrapTrans = wrapTransFunc(trans)
  return [wrapTrans, ...rest] as [typeof wrapTrans, ...typeof rest]
}

/**
 * Hooks that used in function component.
 */
export function useTrans(
  plugins: PluginFunction | PluginFunction[] | null,
  initialLocale: string | (() => string),
  initialFallback: string
): UseTransReturnType

/**
 * Hooks that used in function component.
 */
export function useTrans(
  plugins: PluginFunction | PluginFunction[] | null,
  fallback: string
): UseTransReturnType

/**
 * Hooks that used in function component.
 */
export function useTrans(plugins: PluginFunction | PluginFunction[] | null): UseTransReturnType

/**
 * Hooks that used in function component.
 */
export function useTrans(): UseTransReturnType

/**
 * Hooks that used in function component.
 */
export function useTrans() {
  return useTransWithKeys()
}

/**
 * Hooks with context that used in function component.
 */
export function useContextTrans(...args: Parameters<typeof useContextTransWithKeys>) {
  return useContextTransWithKeys(...args)
}

/**
 * Component that used in class component.
 */
export class Trans extends TransComponent {
  constructor(readonly props: TransPropsWithKeys) {
    super(props)
  }
}

export default useTrans
