/** Vite 把样式作为副作用导入；类型检查只需要模块声明。 */
declare module '*.css' {
  const content: string
  export default content
}
