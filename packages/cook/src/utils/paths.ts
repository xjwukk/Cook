import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Node 专用的数据文件路径。
 *
 * 单独放一个模块，别让浏览器端的代码（如网页里的 CSV 导出、菜谱校验）
 * 通过 config.ts 连带加载 node:path / node:url。
 */

// 基于当前文件位置计算 monorepo 根目录
// paths.ts → src/utils/ → packages/cook/ → 项目根
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../../../..')

// monorepo 根目录
export const rootDir = root

// .env 文件路径
export const envFile = path.resolve(root, '.env')

// Data 文件路径
export const recipeCsvFile = path.resolve(root, 'packages/data/recipe.csv')
export const recipeJsonFile = path.resolve(root, 'packages/data/recipe.json')
export const recipeMetaJsonFile = path.resolve(root, 'packages/data/recipe-meta.json')
export const incompatibleFoodsCsvFile = path.resolve(root, 'packages/data/incompatible-foods.csv')
export const incompatibleFoodsJsonFile = path.resolve(root, 'packages/data/incompatible-foods.json')
/** 视频巡检记下的 B 站数据，用来算菜谱质量分（见 utils/score.ts） */
export const videoStatsJsonFile = path.resolve(root, 'packages/data/video-stats.json')
/** 手写、直接提交的共享数据，参与 dataVersion 计算 */
export const sharedDataFiles = ['aliases.json', 'food.json', 'pantry.json', 'query.json', 'shelf-life.json']
  .map(file => path.resolve(root, 'packages/data', file))
