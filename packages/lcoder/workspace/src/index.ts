/**
 * 宿主侧入口。
 *
 * 工作台的一切都在浏览器侧：页签类型、文案、三栏布局。宿主侧不注册任何东西，
 * 只是让 loader 按包名加载时能取到 `apply`——上游 `ui-sidebar-files` 的
 * `src/index.ts` 也是这么留白的。
 */

/** 宿主侧插件体：工作台不给宿主树贡献任何东西。 */
export function apply(): void {}
