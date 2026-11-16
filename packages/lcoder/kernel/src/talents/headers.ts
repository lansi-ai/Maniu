/**
 * 网关归属头：宿主把模型请求的会话与人才身份交给云端网关。
 *
 * 云网关按 `userId + talentId + sessionId` 给人才预算计数；会话头每次带上，
 * 人才头只在会话当前绑定的是本进程登记的人才时带上。
 */

/** 会话归属头。 */
export const TALENT_SESSION_HEADER = 'x-lcoder-session-id'

/** 人才归属头。 */
export const TALENT_ID_HEADER = 'x-lcoder-talent-id'
