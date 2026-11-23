/**
 * 多环境配置解析 - 通用 Node.js 模块
 * 
 * 特性：
 * - 统一加载 .env 文件和 process.env
 * - 支持环境变量校验（必填项、类型、默认值）
 * - 支持环境预设（按开发/生产/CI 等环境自动应用默认值）
 * - 生成 Vite define 配置对象（注入全局常量到前端代码）
 * - 不依赖 Vite，可在任何 Node.js 项目中使用
 * 
 * 使用示例：
 *   import { createEnvManager } from './core/multiple_env/multi_env.js';
 *   const env = createEnvManager({ ... });
 *   env.load();
 *   env.validate();
 *   // 在 vite.config.js 中使用: define: env.getDefine()
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

/**
 * 简易 .env 文件解析器
 * @param {string} filePath - .env 文件路径
 * @returns {Object} 键值对对象
 */
function parseEnvFile(filePath) {
  const result = {};
  if (!existsSync(filePath)) return result;

  const content = readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // 去除引号
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }
  return result;
}

/**
 * 类型转换
 * @param {string} value
 * @param {string} type
 * @returns {string|number|boolean}
 */
function castValue(value, type) {
  if (value === undefined || value === null) return value;
  switch (type) {
    case 'number':
      return Number(value);
    case 'boolean':
      return value === 'true' || value === '1';
    default:
      return String(value);
  }
}

/**
 * 创建环境管理器实例
 * @param {Object} options - 配置项
 * @param {string} [options.envFile='.env'] - 环境配置文件路径
 * @param {string} [options.prefix=''] - 环境变量前缀（如 'VITE_'），空字符串表示加载所有
 * @param {Object} [options.schema] - 环境变量校验 schema
 *   格式: { VAR_NAME: { required: boolean, default?: string, type?: 'string'|'number'|'boolean' } }
 * @param {Object} [options.define] - 需要注入到前端代码的全局常量映射
 *   格式: { __CONSTANT_NAME__: 'ENV_VAR_NAME' }
 * @param {Object} [options.presets] - 环境预设（按 NODE_ENV 或自定义环境名）
 *   格式: { development: { BASE_PATH: '/' }, production: { BASE_PATH: '/app/' } }
 * @param {string} [options.envName] - 当前环境名（默认读取 process.env.NODE_ENV）
 * @returns {EnvManager}
 */
export function createEnvManager(options = {}) {
  return new EnvManager(options);
}

class EnvManager {
  /**
   * @param {Object} options
   */
  constructor(options = {}) {
    this.envFile = options.envFile || '.env';
    this.prefix = options.prefix || '';
    this.schema = options.schema || {};
    this.defineMap = options.define || {};
    this.presets = options.presets || {};
    this.envName = options.envName || process.env.NODE_ENV || 'development';

    // 存储加载后的环境变量
    this._env = {};
    this._loaded = false;
  }

  /**
   * 加载环境变量（.env 文件 + process.env + 预设 + 默认值）
   * @returns {Object} 加载后的环境变量对象
   */
  load() {
    if (this._loaded) return this._env;

    // 1. 加载 .env 文件
    const fileEnv = parseEnvFile(resolve(process.cwd(), this.envFile));

    // 2. 按前缀过滤（如果设置了 prefix）
    // schema 与 defineMap 中声明的键不受前缀限制，保证 BASE_PATH / SITE_BASE_URL 等可被 process.env 覆盖
    const allowedKeys = new Set([
      ...Object.keys(this.schema),
      ...Object.values(this.defineMap || {})
    ]);
    const filteredFile = {};
    for (const [key, value] of Object.entries(fileEnv)) {
      if (!this.prefix || key.startsWith(this.prefix) || allowedKeys.has(key)) {
        filteredFile[key] = value;
      }
    }
    Object.assign(this._env, filteredFile);

    // 3. 应用环境预设（优先级高于 .env 文件，低于 process.env）
    const preset = this.presets[this.envName];
    if (preset) {
      Object.assign(this._env, preset);
    }

    // 4. 合并 process.env（优先级最高）
    for (const [key, value] of Object.entries(process.env)) {
      if (this.prefix && !key.startsWith(this.prefix) && !allowedKeys.has(key)) continue;
      this._env[key] = value;
    }

    // 5. 应用 schema 默认值
    for (const [key, rule] of Object.entries(this.schema)) {
      if (this._env[key] === undefined && rule.default !== undefined) {
        this._env[key] = rule.default;
      }
    }

    this._loaded = true;
    return this._env;
  }

  /**
   * 获取单个环境变量值
   * @param {string} key - 变量名
   * @returns {string|undefined}
   */
  get(key) {
    if (!this._loaded) this.load();
    return this._env[key];
  }

  /**
   * 获取所有已加载的环境变量
   * @returns {Object}
   */
  getAll() {
    if (!this._loaded) this.load();
    return { ...this._env };
  }

  /**
   * 校验环境变量（检查必填项、类型）
   * @returns {boolean} 校验通过返回 true，否则抛出错误
   */
  validate() {
    if (!this._loaded) this.load();

    const errors = [];
    for (const [key, rule] of Object.entries(this.schema)) {
      const value = this._env[key];

      // 必填项检查
      if (rule.required && (value === undefined || value === '')) {
        errors.push(`Missing required env variable: ${key}`);
        continue;
      }

      // 类型检查
      if (value !== undefined && rule.type) {
        const casted = castValue(value, rule.type);
        if (rule.type === 'number' && isNaN(casted)) {
          errors.push(`Invalid number for env variable: ${key} (got "${value}")`);
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(`Environment validation failed:\n${errors.join('\n')}`);
    }

    return true;
  }

  /**
   * 生成 Vite define 配置对象
   * 用于将环境变量注入到前端代码中作为全局常量
   * @returns {Object} Vite define 配置
   */
  getDefine() {
    if (!this._loaded) this.load();

    const result = {};
    for (const [constName, envVarName] of Object.entries(this.defineMap)) {
      const value = this._env[envVarName] || '';
      result[constName] = JSON.stringify(String(value));
    }
    return result;
  }

  /**
   * 获取部署路径前缀
   * @param {string} [fallback='/'] - 默认值
   * @returns {string} 去掉末尾斜杠的路径前缀
   */
  getBasePath(fallback = '/') {
    const path = this.get('BASE_PATH') || this.get('VITE_BASE_PATH') || fallback;
    return path.replace(/\/$/, '') || '/';
  }

  /**
   * 获取站点基础 URL
   * @param {string} [fallback='http://localhost:5173'] - 默认值
   * @returns {string}
   */
  getBaseUrl(fallback = 'http://localhost:5173') {
    return this.get('VITE_BASE_URL') || this.get('BASE_URL') || fallback;
  }

  /**
   * 获取当前环境名
   * @returns {string}
   */
  getEnvName() {
    return this.envName;
  }

  /**
   * 判断是否为开发环境
   * @returns {boolean}
   */
  isDev() {
    return this.envName === 'development';
  }

  /**
   * 判断是否为生产环境
   * @returns {boolean}
   */
  isProd() {
    return this.envName === 'production';
  }

  /**
   * 打印当前环境变量摘要（调试用）
   */
  dump() {
    if (!this._loaded) this.load();

    console.log('=== Environment Variables ===');
    console.log(`Environment: ${this.envName}`);
    console.log(`BASE_PATH: ${this.getBasePath()}`);
    console.log(`BASE_URL: ${this.getBaseUrl()}`);

    // 打印 schema 中定义的变量
    for (const key of Object.keys(this.schema)) {
      const value = this._env[key];
      const masked = key.toLowerCase().includes('token') || key.toLowerCase().includes('secret')
        ? (value ? '***' : '(empty)')
        : (value || '(empty)');
      console.log(`${key}: ${masked}`);
    }
    console.log('===========================');
  }
}

// 导出工具函数
export { parseEnvFile };

// 默认导出工厂函数
export default createEnvManager;