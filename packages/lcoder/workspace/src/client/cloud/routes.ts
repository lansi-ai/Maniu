/**
 * 云端路由与模型的浏览器侧常量。
 *
 * 值与 `@lcoder/kernel` 的宿主常量一致；客户端只读，不参与路由注册。
 */
export const CLOUD_USER_ROUTE = 'lcoder-cloud'
/** 旧版本匿名立项会话用的路由；桌面端已去匿名，只用来识别遗留会话并切回用户路由。 */
export const CLOUD_LEGACY_GUEST_ROUTE = 'lcoder-cloud-guest'
export const CLOUD_MODEL = 'deepseek-flash'
