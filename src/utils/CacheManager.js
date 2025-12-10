/**
 * 缓存管理器 - 用于优化批量处理性能
 */
export class CacheManager {
    constructor(maxSize = 100) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.hitCount = 0;
        this.missCount = 0;
    }

    /**
     * 生成缓存键
     * @param {string} type 缓存类型
     * @param {*} params 参数
     * @returns {string} 缓存键
     */
    generateKey(type, ...params) {
        return `${type}:${JSON.stringify(params)}`;
    }

    /**
     * 获取缓存值
     * @param {string} key 缓存键
     * @returns {*} 缓存值或 undefined
     */
    get(key) {
        if (this.cache.has(key)) {
            // LRU: 将访问的项移到最后
            const value = this.cache.get(key);
            this.cache.delete(key);
            this.cache.set(key, value);
            this.hitCount++;
            return value;
        }
        this.missCount++;
        return undefined;
    }

    /**
     * 设置缓存值
     * @param {string} key 缓存键
     * @param {*} value 缓存值
     */
    set(key, value) {
        // 如果已存在，先删除
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }
        // 如果达到最大大小，删除最旧的项
        else if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }

    /**
     * 删除缓存项
     * @param {string} key 缓存键
     */
    delete(key) {
        this.cache.delete(key);
    }

    /**
     * 清空缓存
     */
    clear() {
        this.cache.clear();
        this.hitCount = 0;
        this.missCount = 0;
    }

    /**
     * 获取缓存统计
     * @returns {Object} 统计信息
     */
    getStats() {
        const total = this.hitCount + this.missCount;
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hitCount: this.hitCount,
            missCount: this.missCount,
            hitRate: total > 0 ? (this.hitCount / total * 100).toFixed(2) + '%' : '0%'
        };
    }
}

// 创建全局缓存实例
export const messageCache = new CacheManager(200); // 消息缓存
export const tagCache = new CacheManager(100); // 标签提取缓存
export const vectorizationCache = new CacheManager(50); // 向量化结果缓存

// 定期清理缓存
setInterval(() => {
    const msgStats = messageCache.getStats();
    const tagStats = tagCache.getStats();

    console.log('[CacheManager] 缓存统计:', {
        messages: msgStats,
        tags: tagStats
    });

    // 如果命中率太低，清理缓存
    if (parseFloat(msgStats.hitRate) < 30) {
        messageCache.clear();
        console.log('[CacheManager] 清理消息缓存（命中率过低）');
    }
    if (parseFloat(tagStats.hitRate) < 30) {
        tagCache.clear();
        console.log('[CacheManager] 清理标签缓存（命中率过低）');
    }
}, 60000); // 每分钟检查一次