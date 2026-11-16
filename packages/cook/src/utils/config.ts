/**
 * packages/data 里 JSON 的结构版本，写进 recipe-meta.json 的 schemaVersion。
 * 字段改名、删除或改类型时加一，并同步更新 packages/data/schema 和 iOS 的 CookCore；只加可选字段不用改。
 */
export const DATA_SCHEMA_VERSION = 1

// 分片配置
export const CHUNK_SIZE = 200 // 每片菜谱数
export const CHUNK_THRESHOLD = 1000 // 超过此数量启用分片

// CSV Headers
// id 是菜谱的固定编号：收藏、反馈都按它记录，已有行的 id 不能修改或复用
export const RECIPE_CSV_HEADERS = 'name,stuff,bv,difficulty,tags,methods,tools,id,link'
/** 加 link 列之前的表头 */
export const LEGACY_RECIPE_CSV_HEADERS = 'name,stuff,bv,difficulty,tags,methods,tools,id'
/** 飞书表格只有前 7 列，没有 id */
export const FEISHU_RECIPE_HEADERS = 'name,stuff,bv,difficulty,tags,methods,tools'
export const INCOMPATIBLE_FOODS_CSV_HEADERS = 'foodA,foodB,reason'

// 分隔符（食材、标签等使用中文顿号）
export const SEP = '、'

// 飞书相关配置
export const FEISHU_WIKI_NODE_TOKEN = 'KgxowvnB9iM91AkZEJHcNGoQnPg'
export const FEISHU_SHEET_ID = 'X4j9Bn'
