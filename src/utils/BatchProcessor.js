/**
 * 批处理优化器 - 用于优化大量数据处理性能
 */
export class BatchProcessor {
    constructor(options = {}) {
        this.batchSize = options.batchSize || 50; // 每批处理的项目数
        this.batchDelay = options.batchDelay || 10; // 批次间延迟（毫秒）
        this.yieldAfter = options.yieldAfter || 10; // 处理多少项后让出控制权
        this.maxConcurrency = options.maxConcurrency || 3; // 最大并发数
    }

    /**
     * 批量处理数组
     * @param {Array} items 要处理的项目
     * @param {Function} processor 处理函数
     * @param {Function} onProgress 进度回调
     * @returns {Promise<Array>} 处理结果
     */
    async processBatches(items, processor, onProgress) {
        const results = [];
        const total = items.length;
        let processed = 0;

        // 分批处理
        for (let i = 0; i < items.length; i += this.batchSize) {
            const batch = items.slice(i, i + this.batchSize);

            // 处理当前批次
            const batchResults = await this.processBatch(batch, processor);
            results.push(...batchResults);

            processed += batch.length;

            // 进度回调
            if (onProgress) {
                onProgress(processed, total);
            }

            // 让出控制权，避免阻塞UI
            if (i % (this.batchSize * this.yieldAfter) === 0) {
                await this.yield();
            }

            // 批次间延迟
            if (i + this.batchSize < items.length) {
                await this.delay(this.batchDelay);
            }
        }

        return results;
    }

    /**
     * 串行处理数组项（用于需要顺序的场景）
     * @param {Array} items 要处理的项目
     * @param {Function} processor 处理函数
     * @param {Function} onProgress 进度回调
     * @returns {Promise<Array>} 处理结果
     */
    async processSerially(items, processor, onProgress) {
        const results = [];
        const total = items.length;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            // 处理当前项
            const result = await this.wrapInTimeout(() => processor(item), 120000); // 2分钟超时
            results.push(result);

            // 进度回调
            if (onProgress) {
                onProgress(i + 1, total);
            }

            // 让出控制权
            if ((i + 1) % this.yieldAfter === 0) {
                await this.yield();
            }

            // 项间延迟
            if (i < items.length - 1) {
                await this.delay(this.batchDelay);
            }
        }

        return results;
    }

    /**
     * 处理单个批次
     * @param {Array} batch 批次项目
     * @param {Function} processor 处理函数
     * @returns {Promise<Array>} 批次结果
     */
    async processBatch(batch, processor) {
        const promises = batch.map(item =>
            this.wrapInTimeout(() => processor(item))
        );

        return Promise.all(promises);
    }

    /**
     * 将处理函数包装在超时中，避免长时间阻塞
     * @param {Function} fn 处理函数（返回Promise）
     * @param {number} timeout 超时时间（毫秒）
     * @returns {Promise} 包装后的Promise
     */
    wrapInTimeout(fn, timeout = 30000) { // 默认30秒超时
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`处理超时（${timeout/1000}秒）`));
            }, timeout);

            // 确保fn是函数
            if (typeof fn !== 'function') {
                clearTimeout(timer);
                reject(new Error('fn must be a function'));
                return;
            }

            Promise.resolve(fn())
                .then(result => {
                    clearTimeout(timer);
                    resolve(result);
                })
                .catch(error => {
                    clearTimeout(timer);
                    reject(error);
                });
        });
    }

    /**
     * 让出控制权
     */
    async yield() {
        return new Promise(resolve => {
            setTimeout(resolve, 0);
        });
    }

    /**
     * 延迟函数
     * @param {number} ms 延迟毫秒数
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 处理大量消息的特殊方法
     * @param {Array} messages 消息数组
     * @param {Object} options 处理选项
     * @returns {Promise<Array>} 处理结果
     */
    async processMessages(messages, options = {}) {
        const {
            chunkSize = 1000, // 每次处理的字符数
            onProgress = null,
            onChunk = null
        } = options;

        const results = [];
        let processedChars = 0;
        const totalChars = messages.reduce((sum, msg) => sum + (msg.text || '').length, 0);

        // 按字符数分块处理
        for (let i = 0; i < messages.length; i++) {
            const message = messages[i];
            const text = message.text || '';

            // 如果单条消息太长，分段处理
            if (text.length > chunkSize) {
                const chunks = this.splitTextIntoChunks(text, chunkSize);
                for (const chunk of chunks) {
                    results.push({
                        ...message,
                        text: chunk,
                        isChunk: true,
                        originalIndex: i
                    });

                    processedChars += chunk.length;

                    if (onChunk) {
                        onChunk(chunk, i);
                    }
                }
            } else {
                results.push(message);
                processedChars += text.length;
            }

            // 定期报告进度
            if (onProgress && i % 10 === 0) {
                onProgress(i + 1, messages.length, processedChars, totalChars);
            }

            // 定期让出控制权
            if (i % 50 === 0) {
                await this.yield();
            }
        }

        return results;
    }

    /**
     * 将文本分割成块
     * @param {string} text 要分割的文本
     * @param {number} chunkSize 块大小
     * @returns {Array<string>} 文本块数组
     */
    splitTextIntoChunks(text, chunkSize) {
        const chunks = [];
        let start = 0;

        while (start < text.length) {
            let end = start + chunkSize;

            // 尝试在句号、换行符等处分割
            if (end < text.length) {
                const lastPeriod = text.lastIndexOf('.', end);
                const lastNewline = text.lastIndexOf('\n', end);
                const lastSpace = text.lastIndexOf(' ', end);

                const splitPoint = Math.max(
                    lastPeriod > start ? lastPeriod + 1 : -1,
                    lastNewline > start ? lastNewline + 1 : -1,
                    lastSpace > start ? lastSpace + 1 : -1
                );

                if (splitPoint > start && splitPoint < end + 100) {
                    end = splitPoint;
                }
            }

            chunks.push(text.slice(start, end));
            start = end;
        }

        return chunks;
    }
}

// 创建全局批处理实例
export const batchProcessor = new BatchProcessor({
    batchSize: 50,
    batchDelay: 5,
    yieldAfter: 5,
    maxConcurrency: 3
});

// 用于智能追赶的特殊批处理器
export const catchUpProcessor = new BatchProcessor({
    batchSize: 20, // 智能追赶使用较小的批次
    batchDelay: 100, // 更长的延迟，避免过快
    yieldAfter: 2,
    maxConcurrency: 1 // 串行处理，确保顺序
});