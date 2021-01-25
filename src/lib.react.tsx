type Keys = string

//
export * from '@ices/react-locale'
import {
  setLocale,
  Trans as TransComponent,
  useTrans as useTransHook,
  useContextTrans as useContextTransHook,
  PluginFunction,
} from '@ices/react-locale'

type TransComponentProps = Omit<ConstructorParameters<typeof TransComponent>[0], 'id'>
type TransPropsWithKeys = { id: Keys } & TransComponentProps
type UseTransReturnType = [ReturnType<typeof wrapTransFunc>, string, typeof setLocale]

const wrapTransFunc = (trans: ReturnType<typeof useTransHook>[0]) => {
  return (key: Keys, ...pluginArgs: any[]) => trans(key, ...pluginArgs)
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

export function useTrans(
  plugins: PluginFunction | PluginFunction[] | null,
  initialLocale: string | (() => string),
  initialFallback: string
): UseTransReturnType
export function useTrans(
  plugins: PluginFunction | PluginFunction[] | null,
  fallback: string
): UseTransReturnType
export function useTrans(plugins: PluginFunction | PluginFunction[] | null): UseTransReturnType
export function useTrans(): UseTransReturnType
export function useTrans() {
  return useTransWithKeys()
}

export function useContextTrans(...args: Parameters<typeof useContextTransWithKeys>) {
  return useContextTransWithKeys(...args)
}

export class Trans extends TransComponent {
  constructor(readonly props: TransPropsWithKeys) {
    super(props)
  }
}

export default useTrans
