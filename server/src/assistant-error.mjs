/** 助手相关的错误类型；单独成文件，避免 assistant.mjs 与 assistant-images.mjs 互相引用。 */
export class AssistantError extends Error {
  constructor(code, message, status = 502) {
    super(message)
    this.code = code
    this.status = status
  }
}
