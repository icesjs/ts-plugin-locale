const Keys = {} // Keys 的值被替换成已解析的数据
type MessageKeys = keyof typeof Keys // MessageKeys 被替换成已解析的类型

import {
  setLocale,
  Trans as TransComponent,
  useTrans as useTransHook,
  useContextTrans as useContextTransHook,
  PluginFunction as PluginFunctionType,
} from '@ices/react-locale'
export * from '@ices/react-locale'

export { MessageKeys }
type ValidMessageKeys = MessageKeys extends never ? string : MessageKeys
type TransComponentProps = Omit<ConstructorParameters<typeof TransComponent>[0], 'id'>
type TransPropsWithKeys = { id: ValidMessageKeys } & TransComponentProps
type PluginParameters = Parameters<PluginFunctionType>
type PluginTranslateType = PluginParameters[2]
type PluginTransParameters = Parameters<PluginTranslateType>

/**
 * 语言内容转译组件定义类型。
 */
export type TranslateType = typeof Trans

/**
 * useTrans 或 useContextTrans 的返回值类型。
 */
export type UseTransResponse = [ReturnType<typeof wrapTransFunc>, string, typeof setLocale]

/**
 * 插件使用的转译函数，可供插件获取语言模块消息内容。
 */
export type PluginTranslate = ReturnType<typeof wrapPluginTransFunc>

/**
 * 插件函数，用来实现语言内容的格式转译。
 */
export type PluginFunction = (
  message: PluginParameters[0],
  pluginArgs: PluginParameters[1],
  translate: PluginTranslate
) => ReturnType<PluginFunctionType>

const wrapTransFunc = (trans: ReturnType<typeof useTransHook>[0]) => {
  return (key: ValidMessageKeys, ...pluginArgs: any[]) => trans(key, ...pluginArgs)
}

const wrapPluginTransFunc = (trans: PluginTranslateType) => {
  return (
    key: ValidMessageKeys,
    definitions: PluginTransParameters[1],
    options?: PluginTransParameters[2]
  ) => trans(key, definitions, options)
}

const useTransWithKeys = (...args: Parameters<typeof useTransHook>) => {
  const [trans, ...rest] = useTransHook(...args)
  const wrapTrans = wrapTransFunc(trans)
  return [wrapTrans, ...rest] as UseTransResponse
}

const useContextTransWithKeys = (...args: Parameters<typeof useContextTransHook>) => {
  const [trans, ...rest] = useContextTransHook(...args)
  const wrapTrans = wrapTransFunc(trans)
  return [wrapTrans, ...rest] as [typeof wrapTrans, ...typeof rest]
}

/**
 * 函数组件内使用的hook，可提供区域语言内容转译。
 */
export function useTrans(
  plugins: PluginFunction | PluginFunction[] | null,
  initialLocale: string | (() => string),
  initialFallback: string
): UseTransResponse

/**
 * 函数组件内使用的hook，可提供区域语言内容转译。
 */
export function useTrans(
  plugins: PluginFunction | PluginFunction[] | null,
  fallback: string
): UseTransResponse

/**
 * 函数组件内使用的hook，可提供区域语言内容转译。
 */
export function useTrans(plugins: PluginFunction | PluginFunction[] | null): UseTransResponse

/**
 * 函数组件内使用的hook，可提供区域语言内容转译。
 */
export function useTrans(): UseTransResponse

/**
 * 函数组件内使用的hook，可提供区域语言内容转译。
 */
export function useTrans() {
  return useTransWithKeys()
}

/**
 * 函数组件内使用的绑定至指定上下文组件的内容转译hook。
 */
export function useContextTrans(...args: Parameters<typeof useContextTransWithKeys>) {
  return useContextTransWithKeys(...args)
}

/**
 * 类型组件内使用的转译组件。
 */
export class Trans extends TransComponent {
  constructor(readonly props: TransPropsWithKeys) {
    super(props)
  }
}

export default useTrans
