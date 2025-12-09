/**
 * Memory UI Component
 * Handles the memory management interface (UI only)
 */

// Import updateWorldInfoList functions
import { updateWorldInfoList as updateSillyTavernWorldInfoList, loadWorldInfo, METADATA_KEY, getSortedEntries } from '../../../../../../world-info.js';
import { updateWorldInfoList as updatePluginWorldInfoList } from './WorldInfoList.js';
import { getContext, extension_settings } from '../../../../../../extensions.js';
import { chat_metadata, saveChatDebounced, saveMetadata } from '../../../../../../../script.js';


// Using preset format - prompts removed

// Detail level configurations
const detailLevels = {
    concise: '每个分解事件不少于3句话，100字',
    normal: '每个分解事件不少于5句话，150字',
    detailed: '每个分解事件不少于7句话，250字'
};

// Default memory settings
const defaultMemorySettings = {
    source: 'google_openai', // 默认使用Google
    detailLevel: 'normal', // 默认详细程度
    maxTokens: 8192, // 默认最大token数
    summaryFormat: `总结应当遵循以下原则：
- 按时间顺序或逻辑顺序组织信息
- 保留关键事件和重要细节，省略冗余描述
- 直接陈述事实，避免主观评价
- 使用简洁清晰的语言，避免过度修饰
- 突出事件发展脉络和关键转折点
- 不使用任何xml标签包裹，使用纯文字进行叙述
- {{length}}
- 不回避任何敏感内容，保证记录完全还原前文

总结必须使用以下格式：
【关键事件标题】
关键事件概述。
发生地点:
关键角色:
• {分解事件1（小标题形式）}: {简要描述}
• {分解事件2（小标题形式）}: {简要描述}
• {分解事件3（小标题形式）}: {简要描述}
...`, // 默认总结格式
    autoCreateWorldBook: false, // 默认不自动生成世界书
    google_openai: {
        model: 'gemini-1.5-flash',  // 设置默认模型
        apiKey: ''  // 添加API密钥字段
    },
    openai_compatible: {
        url: '',
        model: '',
        apiKey: '',  // 添加API密钥字段
        proxyMode: false  // 反代专用模式，默认关闭
    },
    // prompts removed - using preset format
    autoSummarize: {
        enabled: false,
        interval: 20,  // 每20层自动总结
        messageCount: 6,  // 保留最近6层消息
        lastSummarizedFloor: 0,  // 上次总结的楼层
        autoVectorize: true, // 默认开启总结前自动向量化
        syncWorldInfo: false // 是否同步世界书进度
    },
    hideFloorsAfterSummary: false,  // 总结后隐藏楼层
    disableWorldInfoAfterVectorize: false  // 向量化后禁用世界书条目
};

export class MemoryUI {
    constructor(dependencies = {}) {
        this.memoryService = dependencies.memoryService;
        this.toastr = dependencies.toastr;
        this.eventBus = dependencies.eventBus;
        this.getContext = dependencies.getContext;
        this.oai_settings = dependencies.oai_settings;
        this.settings = dependencies.settings; // 添加settings引用
        this.saveSettingsDebounced = dependencies.saveSettingsDebounced; // 添加保存函数引用
        this.generateRaw = dependencies.generateRaw; // 添加generateRaw API
        this.eventSource = dependencies.eventSource; // 添加eventSource
        this.event_types = dependencies.event_types; // 添加event_types
        this.saveChatConditional = dependencies.saveChatConditional; // 添加saveChatConditional
        this.performVectorization = dependencies.performVectorization; // 添加向量化函数
        this.initialized = false;

        // UI state
        this.isProcessing = false;
        this.isAutoSummarizing = false;  // 防止自动总结并发执行
        this.isCreatingWorldBook = false;  // 防止重复创建世界书
        this.lastResponseHash = null;  // 记录最后处理的响应哈希，防止重复处理
    }

    async init() {
        if (this.initialized) return;
        this.initialized = true;

        // 先加载配置，再绑定事件
        await this.loadApiConfig();
        this.bindEventListeners();
        this.subscribeToEvents();
        
        // 初始化聊天楼层监控
        this.initializeChatFloorMonitor();
    }

    /**
     * 保存数据到当前聊天的元数据
     * @param {string} key - 数据键名
     * @param {*} value - 要保存的值
     */
    saveToChatMetadata(key, value) {
        // 直接使用导入的 chat_metadata
        if (!chat_metadata) {
            console.warn('[MemoryUI] chat_metadata not available');
            return;
        }
        
        // 初始化扩展元数据结构
        if (!chat_metadata.extensions) {
            chat_metadata.extensions = {};
        }
        if (!chat_metadata.extensions.vectors_enhanced) {
            chat_metadata.extensions.vectors_enhanced = {};
        }
        
        // 保存数据
        chat_metadata.extensions.vectors_enhanced[key] = value;
        
        console.log('[MemoryUI] Saved to chat metadata:', key, value);
        
        // 触发保存（防抖）- 使用导入的函数
        saveChatDebounced();
    }

    /**
     * 从当前聊天的元数据获取数据
     * @param {string} key - 数据键名
     * @returns {*} 存储的值或undefined
     */
    getFromChatMetadata(key) {
        // 直接使用导入的 chat_metadata
        if (!chat_metadata) {
            console.warn('[MemoryUI] chat_metadata not available for key:', key);
            return undefined;
        }
        
        const value = chat_metadata?.extensions?.vectors_enhanced?.[key];
        
        // 只在没有找到值时输出调试信息
        if (value === undefined && key === 'lastSummarizedFloor') {
            console.log('[MemoryUI] chat_metadata structure:', {
                hasMetadata: !!chat_metadata,
                hasExtensions: !!chat_metadata?.extensions,
                hasVectorsEnhanced: !!chat_metadata?.extensions?.vectors_enhanced,
                allExtensions: Object.keys(chat_metadata?.extensions || {}),
                vectorsEnhancedData: chat_metadata?.extensions?.vectors_enhanced
            });
        }
        
        return value;
    }

    /**
     * 获取绑定的世界书名称
     */
    getBoundWorldBook() {
        // 尝试从不同位置获取世界书信息
        let chatWorld = null;

        console.log('[MemoryUI] getBoundWorldBook: 开始获取世界书...');
        console.log(`[MemoryUI] getBoundWorldBook: METADATA_KEY = "${METADATA_KEY}"`);

        // 1. 从全局设置获取
        if (this.settings?.worldBook) {
            chatWorld = this.settings.worldBook;
            console.log(`[MemoryUI] getBoundWorldBook: 从全局设置获取到世界书: ${chatWorld}`);
        }

        // 2. 从 chat_metadata 获取 - 优先使用导入的变量
        if (!chatWorld && chat_metadata) {
            console.log(`[MemoryUI] getBoundWorldBook: 使用导入的 chat_metadata:`, chat_metadata);
            console.log(`[MemoryUI] getBoundWorldBook: METADATA_KEY: ${METADATA_KEY}`);
            chatWorld = chat_metadata[METADATA_KEY];
            console.log(`[MemoryUI] getBoundWorldBook: 从导入的 chat_metadata 获取到世界书: ${chatWorld}`);
        }

        // 3. 从 window.chat_metadata 获取
        if (!chatWorld && window.chat_metadata) {
            console.log(`[MemoryUI] getBoundWorldBook: window.chat_metadata:`, window.chat_metadata);
            chatWorld = window.chat_metadata[METADATA_KEY];
            console.log(`[MemoryUI] getBoundWorldBook: 从 window.chat_metadata 获取到世界书: ${chatWorld}`);
        }

        // 4. 从 getContext 获取
        if (!chatWorld) {
            const context = this.getContext?.();
            if (context && context.chat_metadata) {
                console.log(`[MemoryUI] getBoundWorldBook: context.chat_metadata:`, context.chat_metadata);
                chatWorld = context.chat_metadata[METADATA_KEY];
                console.log(`[MemoryUI] getBoundWorldBook: 从 context.chat_metadata 获取到世界书: ${chatWorld}`);
            }
        }

        // 注意：自动绑定现在在 ensureWorldBookBound 中处理，这里只是返回已绑定的世界书

        return chatWorld;
    }

    /**
     * 获取上次总结的楼层（综合Metadata和世界书）
     * @param {boolean} forceSync - 是否强制使用世界书进度（即使比当前记录小）
     * @returns {Promise<number>} 上次总结的楼层索引（Next Start Index）
     */
    async getLastSummarizedFloor(forceSync = false) {
        // 1. 获取 Metadata 中的值
        let lastSummarized = this.getFromChatMetadata('lastSummarizedFloor') ?? 0;
        console.log(`[MemoryUI] getLastSummarizedFloor: 初始 lastSummarized (from metadata): ${lastSummarized}`);

        // 2. 检查是否开启了同步世界书选项
        const syncEnabled = $('#memory_auto_sync_world_info').prop('checked') ||
                           this.settings?.memory?.autoSummarize?.syncWorldInfo || false;
        console.log(`[MemoryUI] getLastSummarizedFloor: syncEnabled: ${syncEnabled}, forceSync: ${forceSync}`);

        if (!syncEnabled && !forceSync) {
            console.log(`[MemoryUI] getLastSummarizedFloor: 同步未启用且未强制同步，返回 metadata 值: ${lastSummarized}`);
            return lastSummarized;
        }

        try {
            // 3. 尝试从世界书获取进度
            let chatWorld = this.getBoundWorldBook();
            console.log(`[MemoryUI] getLastSummarizedFloor: 获取到的 chatWorld: ${chatWorld}`);

            // 如果没有绑定世界书，尝试自动绑定
            if (!chatWorld && (syncEnabled || forceSync)) {
                console.log('[MemoryUI] getLastSummarizedFloor: 没有绑定世界书，尝试自动绑定...');
                console.log(`[MemoryUI] getLastSummarizedFloor: syncEnabled=${syncEnabled}, forceSync=${forceSync}`);
                chatWorld = this.ensureWorldBookBound();
                console.log(`[MemoryUI] getLastSummarizedFloor: 自动绑定后的 chatWorld: ${chatWorld}`);
            } else {
                console.log(`[MemoryUI] getLastSummarizedFloor: 跳过自动绑定 - chatWorld=${chatWorld}, syncEnabled=${syncEnabled}, forceSync=${forceSync}`);
            }

            if (!chatWorld) {
                console.warn('[MemoryUI] getLastSummarizedFloor: 没有绑定世界书，无法同步。');
                // 在 forceSync 模式下，如果世界书未绑定，也应该重置为 0
                if (forceSync) {
                    this.saveToChatMetadata('lastSummarizedFloor', 0);
                    return 0;
                }
                return lastSummarized; // 否则回退到 metadata 值
            }

            const worldData = await loadWorldInfo(chatWorld);
            console.log(`[MemoryUI] getLastSummarizedFloor: worldData 加载成功: ${!!worldData}, 条目数: ${Object.keys(worldData?.entries || {}).length}`);
            if (!worldData || !worldData.entries) {
                console.warn('[MemoryUI] getLastSummarizedFloor: 无法加载世界书数据或没有条目。');
                if (forceSync) {
                    this.saveToChatMetadata('lastSummarizedFloor', 0);
                    return 0;
                }
                return lastSummarized; // 否则回退到 metadata 值
            }

            let maxFloor = -1;
            console.log('[MemoryUI] getLastSummarizedFloor: 开始扫描世界书条目...');

            // 遍历所有条目寻找楼层信息
            Object.values(worldData.entries).forEach(entry => {
                const textToSearch = (entry.comment || '') + ' ' + (entry.key ? entry.key.join(' ') : '');
                console.log(`[MemoryUI] getLastSummarizedFloor: 扫描条目 (UID: ${entry.uid}, Comment: "${entry.comment || ''}") - 搜索文本: "${textToSearch}"`);
                
                const matches = textToSearch.match(/#(\d+)(?:-(\d+))?/g);
                console.log(`[MemoryUI] getLastSummarizedFloor: 正则匹配结果: ${JSON.stringify(matches)}`);
                
                if (matches) {
                    matches.forEach(match => {
                        const nums = match.match(/(\d+)/g);
                        console.log(`[MemoryUI] getLastSummarizedFloor: 提取到的数字: ${JSON.stringify(nums)}`);
                        if (nums) {
                            nums.forEach(n => {
                                const floor = parseInt(n, 10);
                                if (!isNaN(floor) && floor > maxFloor) {
                                    console.log(`[MemoryUI] getLastSummarizedFloor: 发现新最大楼层: ${floor}`);
                                    maxFloor = floor;
                                }
                            });
                        }
                    });
                }
            });
            console.log(`[MemoryUI] getLastSummarizedFloor: 扫描完成，最终 maxFloor: ${maxFloor}`);

            if (maxFloor > -1) {
                // maxFloor 是已总结的最后一层 (例如 4)
                // 下一次开始应该是 maxFloor + 1 (例如 5)
                const worldInfoNextStart = maxFloor + 1;
                console.log(`[MemoryUI] getLastSummarizedFloor: 计算得出的 worldInfoNextStart: ${worldInfoNextStart}`);
                
                // 如果是强制同步，或者检测到的进度比当前记录大
                if (forceSync || worldInfoNextStart > lastSummarized) {
                    console.log(`[MemoryUI] getLastSummarizedFloor: 触发更新 metadata: ${lastSummarized} -> ${worldInfoNextStart} (检测到最大楼层 #${maxFloor}, 强制: ${forceSync})`);
                    
                    // 自动更新 metadata
                    this.saveToChatMetadata('lastSummarizedFloor', worldInfoNextStart);
                    console.log(`[MemoryUI] getLastSummarizedFloor: 返回 worldInfoNextStart: ${worldInfoNextStart}`);
                    return worldInfoNextStart;
                } else {
                    console.log(`[MemoryUI] getLastSummarizedFloor: 世界书进度 (${worldInfoNextStart}) 未大于当前记录 (${lastSummarized}) 且未强制同步。返回当前记录: ${lastSummarized}`);
                }
            } else { // maxFloor <= -1 (世界书里没找到楼层信息)
                if (forceSync) {
                    // 如果是强制同步，但世界书里没找到楼层信息，则直接重置为0
                    console.log('[MemoryUI] getLastSummarizedFloor: 强制同步但未在世界书中发现楼层信息，重置为0');
                    this.saveToChatMetadata('lastSummarizedFloor', 0);
                    return 0;
                } else {
                    console.log('[MemoryUI] getLastSummarizedFloor: 未在世界书中发现楼层信息且未强制同步。返回 metadata 值。');
                }
            }
        } catch (error) {
            console.error('[MemoryUI] getLastSummarizedFloor: 同步世界书进度失败 (异常):', error);
            // 如果出错，且是强制同步，也应该重置为0
            if (forceSync) {
                console.log('[MemoryUI] getLastSummarizedFloor: 强制同步因错误失败，重置为0');
                this.saveToChatMetadata('lastSummarizedFloor', 0);
                return 0;
            }
        }

        console.log(`[MemoryUI] getLastSummarizedFloor: 最终回退或未更新，返回: ${lastSummarized}`);
        return lastSummarized; // 如果没有触发世界书同步，或者世界书进度没有更新，返回metadata的原始值
    }    bindEventListeners() {
        // Summarize button click handler
        $('#memory_summarize_btn').off('click').on('click', () => this.handleSummarizeClick());

        // API source change
        $('#memory_api_source').off('change').on('change', (e) => {
            this.handleApiSourceChange(e.target.value);
        });


        // Prompt buttons removed - using preset format

        // Save config on input changes (包括API密钥)
        $('#memory_openai_url, #memory_openai_api_key, #memory_openai_model, #memory_google_openai_api_key, #memory_google_openai_model, #memory_summary_format, #memory_detail_level, #memory_max_tokens, #memory_auto_create_world_book, #memory_hide_floors_after_summary, #memory_disable_world_info_after_vectorize')
            .off('change input').on('change input', () => this.saveApiConfig());

        // Reset button for summary format
        $('#reset_memory_summary_format').off('click').on('click', () => this.resetSummaryFormat());

        // Vectorize summary button handler
        $('#memory_vectorize_summary').off('click').on('click', () => this.vectorizeChatLore());
        
        // Auto-summarize settings
        $('#memory_auto_summarize_enabled').off('change').on('change', (e) => {
            const enabled = e.target.checked;
            $('#memory_auto_summarize_settings').toggle(enabled);
            $('#memory_auto_summarize_status').toggle(enabled);
            if (enabled) {
                // 初始化lastSummarizedFloor，确保有固定的基准点
                const lastSummarized = this.getFromChatMetadata('lastSummarizedFloor');
                if (!lastSummarized || lastSummarized === 0) {
                    const context = this.getContext ? this.getContext() : getContext();
                    const currentFloor = context?.chat?.length - 1 || 0;
                    console.log('[MemoryUI] 初始化lastSummarizedFloor为当前楼层:', currentFloor);
                    this.saveToChatMetadata('lastSummarizedFloor', currentFloor);
                }
                this.updateAutoSummarizeStatus();
            }
            this.saveApiConfig();
        });
        
        $('#memory_auto_summarize_interval, #memory_auto_summarize_count, #memory_auto_vectorize_before_summary, #memory_auto_sync_world_info')
            .off('change input').on('change input', (e) => {
                // 如果是保留数量输入框，确保最小值为1
                if (e.target.id === 'memory_auto_summarize_count') {
                    const value = parseInt(e.target.value) || 0;
                    if (value < 1) {
                        e.target.value = 1;
                    }
                }
                this.updateAutoSummarizeStatus();
                this.saveApiConfig();
            });
        
        // Reset auto-summarize button handler
        $('#memory_reset_auto_summarize').off('click').on('click', () => {
            this.resetAutoSummarize();
        });

        // 不在这里初始化API源显示，因为loadApiConfig已经处理了
    }

    subscribeToEvents() {
        if (!this.eventBus) return;

        // Subscribe to memory service events
        this.eventBus.on('memory:message-start', () => {
            this.showLoading();
        });

        this.eventBus.on('memory:message-complete', async (data) => {
            const response = data.response || '';
            
            // 生成响应哈希以检测重复
            const responseHash = this.generateHash(response + Date.now().toString().slice(-5));
            
            // 检查是否是重复的响应
            if (this.lastResponseHash === responseHash) {
                console.log('[MemoryUI] 忽略重复的响应');
                return;
            }
            this.lastResponseHash = responseHash;
            
            // 检查响应是否有效
            if (!response || response.trim().length < 2) {
                console.error('[MemoryUI] AI返回空内容');
                // 确保错误提示能显示
                setTimeout(() => {
                    if (this.toastr) {
                        this.toastr.error('AI返回了空内容，请检查API设置和网络连接', '总结失败', {
                            timeOut: 5000,
                            extendedTimeOut: 2000,
                            preventDuplicates: true
                        });
                    } else {
                        alert('AI返回了空内容，请检查API设置和网络连接');
                    }
                }, 100);
                this.displayResponse('');
                this.hideLoading();
                return;
            }
            
            // 检查是否包含错误信息（短响应中包含错误关键词）
            const errorKeywords = ['error', 'Error', 'ERROR', '错误', '失败', 'failed', 'Failed'];
            const lowerResponse = response.toLowerCase();
            const isError = errorKeywords.some(keyword => 
                lowerResponse.includes(keyword.toLowerCase()) && response.length < 100
            );
            
            if (isError) {
                console.warn('[MemoryUI] AI可能返回了错误:', response);
                this.toastr?.warning('AI响应可能包含错误：' + response.substring(0, 50) + '...');
            }
            
            this.displayResponse(response);
            this.hideLoading();
            
            // 只有有效响应且启用了自动生成才创建世界书
            if (response && response.trim().length >= 2) {
                // 检查是否启用了自动创建世界书
                const autoCreate = $('#memory_auto_create_world_book').prop('checked') || 
                                  this.settings?.memory?.autoCreateWorldBook || false;
                
                if (autoCreate) {
                    console.log('[MemoryUI] 自动创建世界书已启用，准备创建...');
                    // 延迟一下确保UI已更新
                    setTimeout(() => {
                        console.log('[MemoryUI] 开始创建世界书...');
                        this.createWorldBook().catch(error => {
                            console.error('[MemoryUI] 自动创建世界书失败:', error);
                            this.toastr?.error('自动创建世界书失败: ' + error.message);
                        });
                    }, 100);
                } else {
                    console.log('[MemoryUI] 自动创建世界书未启用');
                }
            }
        });

        this.eventBus.on('memory:message-error', (data) => {
            this.displayError(data.error);
            this.hideLoading();
        });

        this.eventBus.on('memory:history-updated', () => {
            // Future: Update history display
        });
    }

    /**
     * Handle summarize button click
     */
    async handleSummarizeClick() {
        if (this.isProcessing) return;

        try {
            // 获取 extension_settings 和 context
            const { extension_settings, getContext } = await import('../../../../../../extensions.js');
            const settings = extension_settings.vectors_enhanced;
            const context = getContext();
            
            // 检查主开关是否启用
            if (!settings.master_enabled) {
                this.toastr?.warning('聊天记录超级管理器已禁用，请先启用主开关');
                return;
            }
            
            // 检查聊天内容是否启用
            if (!settings.selected_content.chat.enabled) {
                this.toastr?.warning('请先在内容选择中启用聊天记录');
                return;
            }
            
            // 检查是否有聊天记录
            if (!context.chat || context.chat.length === 0) {
                this.toastr?.warning('当前没有聊天记录');
                return;
            }
            
            // 导入必要的函数和工具
            const { getMessages } = await import('../../utils/chatUtils.js');
            const { extractTagContent } = await import('../../utils/tagExtractor.js');
            
            // 获取聊天设置
            const chatSettings = settings.selected_content.chat;
            const rules = chatSettings.tag_rules || settings.tag_extraction_rules || [];
            
            // 使用 getMessages 函数获取过滤后的消息
            const messageOptions = {
                includeHidden: chatSettings.include_hidden || false,
                types: chatSettings.types || { user: true, assistant: true },
                range: chatSettings.range,
                newRanges: chatSettings.newRanges
            };
            
            const messages = getMessages(context.chat, messageOptions);
            
            if (messages.length === 0) {
                this.toastr?.warning('没有找到符合条件的聊天内容');
                return;
            }
            
            // 获取楼层编号范围
            const indices = messages.map(msg => msg.index).sort((a, b) => a - b);
            const startIndex = indices[0];
            const endIndex = indices[indices.length - 1];
            const floorRange = { start: startIndex, end: endIndex, count: messages.length };
            
            // 处理并格式化聊天内容
            const chatTexts = messages.map(msg => {
                let extractedText;
                
                // 检查是否为首楼（index === 0）或用户楼层（msg.is_user === true）
                if (msg.index === 0 || msg.is_user === true) {
                    // 首楼或用户楼层：使用完整的原始文本，不应用标签提取规则
                    extractedText = msg.text;
                } else {
                    // 其他楼层：应用标签提取规则
                    extractedText = extractTagContent(msg.text, rules, this.settings.content_blacklist || []);
                }
                
                const msgType = msg.is_user ? '用户' : 'AI';
                return `#${msg.index} [${msgType}]: ${extractedText}`;
            }).join('\n\n');
            
            // 添加楼层信息头部
            const headerInfo = `【楼层 #${startIndex + 1} 至 #${endIndex + 1}，共 ${messages.length} 条消息】\n\n`;
            const contentWithHeader = headerInfo + chatTexts;
            
            // Get API configuration
            const apiSource = $('#memory_api_source').val();
            const apiConfig = this.getApiConfig();
            
            console.log('[MemoryUI] API配置:', {
                source: apiSource,
                config: apiConfig,
                hasApiKey: !!apiConfig.apiKey
            });
            
            // Get summary format and replace {{length}} macro
            let summaryFormat = $('#memory_summary_format').val() || this.settings.memory?.summaryFormat || defaultMemorySettings.summaryFormat;
            const detailLevel = $('#memory_detail_level').val() || this.settings.memory?.detailLevel || defaultMemorySettings.detailLevel;
            summaryFormat = summaryFormat.replace('{{length}}', detailLevels[detailLevel]);

            this.showLoading();
            
            // 显示总结开始提示
            this.toastr?.info(`开始总结楼层 #${startIndex + 1} 至 #${endIndex + 1} 的内容...`);
            
            // 临时存储楼层信息
            this._tempFloorRange = floorRange;
            
            // 设置处理标志，防止重复请求
            this.isProcessing = true;
            
            try {
                const maxTokens = parseInt($('#memory_max_tokens').val()) || this.settings.memory?.maxTokens || defaultMemorySettings.maxTokens;
                const result = await this.memoryService.sendMessage(contentWithHeader, {
                    apiSource: apiSource,
                    apiConfig: apiConfig,
                    summaryFormat: summaryFormat,
                    maxTokens: maxTokens
                });
                
                if (result.success) {
                    this.toastr?.success(`已总结楼层 #${startIndex + 1} 至 #${endIndex + 1} 的内容`);
                    
                    // 检查是否需要隐藏楼层
                    await this.hideFloorsIfEnabled(startIndex, endIndex, false);
                }
            } catch (error) {
                console.error('[MemoryUI] 总结失败:', error);
                this.toastr?.error('总结失败: ' + error.message);
                this.hideLoading();
            } finally {
                // 重置处理标志
                this.isProcessing = false;
            }
        } catch (error) {
            console.error('[MemoryUI] 获取聊天内容失败:', error);
            this.toastr?.error('获取聊天内容失败: ' + error.message);
        }
    }

    /**
     * Handle send button click
     */
    async handleSendClick() {
        if (this.isProcessing) return;

        const input = $('#memory_input').val().trim();
        if (!input) {
            this.toastr?.warning('请输入消息');
            return;
        }

        // Get API configuration
        const apiSource = $('#memory_api_source').val();
        const apiConfig = this.getApiConfig();
        
        // Get summary format and replace {{length}} macro
        let summaryFormat = $('#memory_summary_format').val() || this.settings.memory?.summaryFormat || defaultMemorySettings.summaryFormat;
        const detailLevel = $('#memory_detail_level').val() || this.settings.memory?.detailLevel || defaultMemorySettings.detailLevel;
        summaryFormat = summaryFormat.replace('{{length}}', detailLevels[detailLevel]);

        // Get UI settings - prompts removed, using preset format
        const maxTokens = parseInt($('#memory_max_tokens').val()) || this.settings.memory?.maxTokens || defaultMemorySettings.maxTokens;
        const options = {
            apiSource: apiSource,
            apiConfig: apiConfig,
            summaryFormat: summaryFormat,
            maxTokens: maxTokens
        };

        // Delegate to service
        this.isProcessing = true;
        this.setUIState(false);

        try {
            const result = await this.memoryService.sendMessage(input, options); // 只传递用户输入

            if (result.success) {
                // Clear input on success
                $('#memory_input').val('');
            }

        } catch (error) {
            // Error handling is done via events
            console.error('Memory UI error:', error);
        } finally {
            this.isProcessing = false;
            this.setUIState(true);
        }
    }


    /**
     * Show loading state
     */
    showLoading() {
        $('#memory_loading').show();
        $('#memory_output').val('');
    }

    /**
     * Hide loading state
     */
    hideLoading() {
        $('#memory_loading').hide();
    }

    /**
     * Display AI response
     * @param {string} response - AI response text
     */
    displayResponse(response) {
        $('#memory_output').val(response);
    }


    /**
     * Display error message
     * @param {Error} error - Error object
     */
    displayError(error) {
        this.toastr?.error(`发送失败: ${error.message}`);
        $('#memory_output').val(`错误: ${error.message}`);
    }

    /**
     * Enable/disable UI elements
     * @param {boolean} enabled - Whether to enable UI
     */
    setUIState(enabled) {
        $('#memory_input').prop('disabled', !enabled);
        $('#memory_send_btn').prop('disabled', !enabled);
    }

    /**
     * Get current UI values
     * @returns {Object} Current UI values
     */
    getUIValues() {
        return {
            input: $('#memory_input').val()
        };
    }

    /**
     * Set UI values
     * @param {Object} values - Values to set
     */
    setUIValues(values) {
        if (values.input !== undefined) {
            $('#memory_input').val(values.input);
        }
    }


    // Prompt restore methods removed - using preset format


    /**
     * Simple hash function for duplicate detection
     */
    generateHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash.toString(36);
    }

    /**
     * Create a new world book
     */
    async createWorldBook() {
        // 防止重复创建
        if (this.isCreatingWorldBook) {
            console.log('[MemoryUI] 世界书创建正在进行中，跳过重复请求');
            return;
        }
        
        try {
            this.isCreatingWorldBook = true;
            // 检查是否有AI回复内容
            const outputContent = $('#memory_output').val();
            const hasSummaryContent = outputContent && outputContent.trim();
            
            // 获取楼层信息（使用临时存储的信息）
            const floorRange = this._tempFloorRange;
            
            // 调用服务层方法创建世界书，传入总结标志和楼层信息
            const result = await this.memoryService.createWorldBook(hasSummaryContent, floorRange);
            
            // 清除临时存储的楼层信息
            this._tempFloorRange = null;
            
            if (result.success) {
                // 根据不同操作构建不同的成功消息
                let successMessage = '';
                
                if (result.isNewWorldBook) {
                    // 新建世界书的情况
                    successMessage = `成功创建世界书: ${result.name}`;
                    if (result.newEntry) {
                        successMessage += '，并添加了第一个总结条目';
                    }
                } else {
                    // 世界书已存在的情况
                    if (result.newEntry) {
                        successMessage = `在世界书"${result.name}"中添加了新的总结条目`;
                    } else {
                        successMessage = `世界书"${result.name}"已存在`;
                    }
                }
                
                if (result.boundToChatLore) {
                    successMessage += '，已绑定为当前聊天的知识库';
                }
                
                this.toastr?.success(successMessage);
                
                // 触发世界书更新事件
                if (this.eventSource && this.event_types) {
                    this.eventSource.emit(this.event_types.WORLDINFO_UPDATED, result.name, result.data);
                }
                
                // 调用 SillyTavern 的更新函数来刷新主界面列表
                await updateSillyTavernWorldInfoList();
                
                // 调用插件的更新函数来刷新插件内部列表
                await updatePluginWorldInfoList();
            }
            
        } catch (error) {
            console.error('[MemoryUI] 创建世界书失败:', error);
            this.toastr?.error('创建世界书失败: ' + error.message);
        } finally {
            // 无论成功还是失败，都要重置标志
            this.isCreatingWorldBook = false;
        }
    }


    /**
     * Initialize API source display without saving
     * @param {string} source - Selected API source
     */
    initializeApiSourceDisplay(source) {
        // Hide all settings
        $('#memory_openai_settings, #memory_google_openai_settings').hide();

        // Show relevant settings
        switch(source) {
            case 'openai_compatible':
                $('#memory_openai_settings').show();
                break;
            case 'google_openai':
                $('#memory_google_openai_settings').show();
                break;
        }
    }

    /**
     * Handle API source change
     * @param {string} source - Selected API source
     */
    handleApiSourceChange(source) {
        // Hide all settings
        $('#memory_openai_settings, #memory_google_openai_settings').hide();

        // Show relevant settings
        switch(source) {
            case 'openai_compatible':
                $('#memory_openai_settings').show();
                break;
            case 'google_openai':
                $('#memory_google_openai_settings').show();
                break;
        }

        // Save selection
        this.saveApiConfig();
    }


    /**
     * Get current API configuration
     * @returns {Object} API configuration
     */
    getApiConfig() {
        const source = $('#memory_api_source').val();

        switch(source) {
            case 'openai_compatible':
                return {
                    url: $('#memory_openai_url').val(),
                    apiKey: $('#memory_openai_api_key').val(),
                    model: $('#memory_openai_model').val() || '',
                    proxyMode: $('#memory_openai_proxy_mode').prop('checked') || false
                };
            case 'google_openai':
                return {
                    apiKey: $('#memory_google_openai_api_key').val(),
                    model: $('#memory_google_openai_model').val() || ''
                };
            default:
                return {};
        }
    }

    /**
     * 保存API配置到扩展设置
     */
    async saveApiConfig() {
        // 使用传入的settings引用
        if (!this.settings) {
            console.error('[MemoryUI] settings引用不可用');
            return;
        }

        // 直接保存到settings对象
        const memoryConfig = {
            source: $('#memory_api_source').val(),
            summaryFormat: $('#memory_summary_format').val() || defaultMemorySettings.summaryFormat,
            detailLevel: $('#memory_detail_level').val() || defaultMemorySettings.detailLevel,
            maxTokens: parseInt($('#memory_max_tokens').val()) || defaultMemorySettings.maxTokens,
            autoCreateWorldBook: $('#memory_auto_create_world_book').prop('checked'),
            openai_compatible: {
                url: $('#memory_openai_url').val(),
                model: $('#memory_openai_model').val() || '',
                apiKey: $('#memory_openai_api_key').val() || '',  // 直接保存API密钥
                proxyMode: $('#memory_openai_proxy_mode').prop('checked') || false
            },
            google_openai: {
                model: $('#memory_google_openai_model').val() || '',
                apiKey: $('#memory_google_openai_api_key').val() || ''  // 直接保存API密钥
            },
            // prompts removed - using preset format
            autoSummarize: {
                enabled: $('#memory_auto_summarize_enabled').prop('checked'),
                interval: parseInt($('#memory_auto_summarize_interval').val()) || 20,
                messageCount: Math.max(1, parseInt($('#memory_auto_summarize_count').val()) || 1),
                // 不再保存 lastSummarizedFloor 到全局设置，它现在存储在聊天元数据中
                lastSummarizedFloor: this.settings?.memory?.autoSummarize?.lastSummarizedFloor || 0,
                autoVectorize: $('#memory_auto_vectorize_before_summary').prop('checked'),
                syncWorldInfo: $('#memory_auto_sync_world_info').prop('checked')
            },
            hideFloorsAfterSummary: $('#memory_hide_floors_after_summary').prop('checked'),
            disableWorldInfoAfterVectorize: $('#memory_disable_world_info_after_vectorize').prop('checked')
        };
        
        this.settings.memory = memoryConfig;

        // 保存设置 - 需要先同步到extension_settings
        const context = this.getContext();
        if (context && context.extensionSettings && context.extensionSettings.vectors_enhanced) {
            // 深度复制memory设置到extension_settings
            context.extensionSettings.vectors_enhanced.memory = JSON.parse(JSON.stringify(this.settings.memory));
        }
        
        if (this.saveSettingsDebounced) {
            this.saveSettingsDebounced();
        } else if (window.saveSettingsDebounced) {
            window.saveSettingsDebounced();
        }
    }

    /**
     * 加载API配置
     */
    async loadApiConfig() {
        // 使用传入的settings引用
        if (!this.settings) {
            console.error('[MemoryUI] settings引用不可用');
            return;
        }
        
        // 如果没有memory配置，使用默认设置初始化
        if (!this.settings.memory) {
            this.settings.memory = { ...defaultMemorySettings };
            // 保存默认设置
            if (this.saveSettingsDebounced) {
                this.saveSettingsDebounced();
            }
        }
        
        // 获取配置
        const config = this.settings.memory;

        // 加载配置到UI
        
        $('#memory_api_source').val(config.source || 'google_openai');
        $('#memory_summary_format').val(config.summaryFormat || defaultMemorySettings.summaryFormat);
        $('#memory_detail_level').val(config.detailLevel || defaultMemorySettings.detailLevel);
        $('#memory_max_tokens').val(config.maxTokens || defaultMemorySettings.maxTokens);
        $('#memory_auto_create_world_book').prop('checked', config.autoCreateWorldBook || false);
        $('#memory_openai_url').val(config.openai_compatible?.url || '');
        $('#memory_openai_model').val(config.openai_compatible?.model || '');
        $('#memory_openai_api_key').val(config.openai_compatible?.apiKey || '');  // 从设置加载API密钥
        $('#memory_openai_proxy_mode').prop('checked', config.openai_compatible?.proxyMode || false);
        $('#memory_google_openai_model').val(config.google_openai?.model || '');
        $('#memory_google_openai_api_key').val(config.google_openai?.apiKey || '');  // 从设置加载API密钥
        
        // Auto-summarize settings
        if (config.autoSummarize) {
            $('#memory_auto_summarize_enabled').prop('checked', config.autoSummarize.enabled || false);
            $('#memory_auto_summarize_interval').val(config.autoSummarize.interval || 20);
            $('#memory_auto_summarize_count').val(config.autoSummarize.messageCount || 6);
            $('#memory_auto_vectorize_before_summary').prop('checked', config.autoSummarize.autoVectorize !== false); // 默认为 true
            $('#memory_auto_sync_world_info').prop('checked', config.autoSummarize.syncWorldInfo || false);
            $('#memory_auto_summarize_settings').toggle(config.autoSummarize.enabled || false);
            $('#memory_auto_summarize_status').toggle(config.autoSummarize.enabled || false);
            if (config.autoSummarize.enabled) {
                this.updateAutoSummarizeStatus();
            }
        }
        
        // Hide floors setting
        $('#memory_hide_floors_after_summary').prop('checked', config.hideFloorsAfterSummary || false);
        
        // Disable world info after vectorize setting
        $('#memory_disable_world_info_after_vectorize').prop('checked', config.disableWorldInfoAfterVectorize || false);
        
        // Prompts loading removed - using preset format

        // 更新UI显示
        this.initializeApiSourceDisplay(config.source || 'google_openai');
    }

    /**
     * 注入选中的聊天内容到输入框
     */
    async injectSelectedContent() {
        try {
            // 获取 extension_settings 和 context
            const { extension_settings, getContext } = await import('../../../../../../extensions.js');
            const settings = extension_settings.vectors_enhanced;
            const context = getContext();
            
            // 检查聊天内容是否启用
            if (!settings.selected_content.chat.enabled) {
                this.toastr?.warning('请先在内容选择中启用聊天记录');
                return;
            }
            
            // 检查是否有聊天记录
            if (!context.chat || context.chat.length === 0) {
                this.toastr?.warning('当前没有聊天记录');
                return;
            }
            
            // 导入必要的函数和工具
            const { getMessages } = await import('../../utils/chatUtils.js');
            const { extractTagContent } = await import('../../utils/tagExtractor.js');
            
            // 获取聊天设置
            const chatSettings = settings.selected_content.chat;
            const rules = chatSettings.tag_rules || settings.tag_extraction_rules || [];
            
            // 使用 getMessages 函数获取过滤后的消息
            const messageOptions = {
                includeHidden: chatSettings.include_hidden || false,
                types: chatSettings.types || { user: true, assistant: true },
                range: chatSettings.range,
                newRanges: chatSettings.newRanges
            };
            
            const messages = getMessages(context.chat, messageOptions);
            
            if (messages.length === 0) {
                this.toastr?.warning('没有找到符合条件的聊天内容');
                return;
            }
            
            // 获取楼层编号范围
            const indices = messages.map(msg => msg.index).sort((a, b) => a - b);
            const startIndex = indices[0];
            const endIndex = indices[indices.length - 1];
            
            // 处理并格式化聊天内容
            const chatTexts = messages.map(msg => {
                let extractedText;
                
                // 检查是否为首楼（index === 0）或用户楼层（msg.is_user === true）
                if (msg.index === 0 || msg.is_user === true) {
                    // 首楼或用户楼层：使用完整的原始文本，不应用标签提取规则
                    extractedText = msg.text;
                } else {
                    // 其他楼层：应用标签提取规则
                    extractedText = extractTagContent(msg.text, rules, this.settings.content_blacklist || []);
                }
                
                const msgType = msg.is_user ? '用户' : 'AI';
                return `#${msg.index} [${msgType}]: ${extractedText}`;
            }).join('\n\n');
            
            // 添加楼层信息头部
            const headerInfo = `【注入内容：楼层 #${startIndex + 1} 至 #${endIndex + 1}，共 ${messages.length} 条消息】\n\n`;
            const contentWithHeader = headerInfo + chatTexts;
            
            // 注入到输入框
            const inputElement = $('#memory_input');
            const currentValue = inputElement.val();
            
            // 如果输入框已有内容，添加分隔符
            if (currentValue && currentValue.trim()) {
                inputElement.val(currentValue + '\n\n---\n\n' + contentWithHeader);
            } else {
                inputElement.val(contentWithHeader);
            }
            
            // 触发 input 事件，以防有其他监听器
            inputElement.trigger('input');
            
            // 存储楼层信息到数据属性，以便其他功能使用
            inputElement.data('injected-range', { start: startIndex, end: endIndex, count: messages.length });
            
            // 显示更详细的提示
            this.toastr?.info(`已注入楼层 #${startIndex + 1} 至 #${endIndex + 1} 的 ${messages.length} 条聊天记录`);
            
        } catch (error) {
            console.error('[MemoryUI] 注入内容失败:', error);
            this.toastr?.error('注入内容失败: ' + error.message);
        }
    }

    /**
     * 向量化当前聊天的总结内容
     */
    async vectorizeChatLore() {
        try {
            // 检查主开关是否启用
            if (!this.settings?.master_enabled) {
                this.toastr?.warning('聊天记录超级管理器已禁用，请先启用主开关');
                return;
            }
            // 尝试多种方式获取chat world
            let chatWorld = chat_metadata?.[METADATA_KEY];
            
            // 如果直接获取失败，尝试从getContext获取
            if (!chatWorld) {
                const context = this.getContext ? this.getContext() : window.getContext?.();
                if (context && context.chat_metadata) {
                    chatWorld = context.chat_metadata[METADATA_KEY];
                }
            }
            
            // 如果还是没有，尝试window.chat_metadata
            if (!chatWorld && window.chat_metadata) {
                chatWorld = window.chat_metadata[METADATA_KEY];
            }
            
            console.log('[MemoryUI] Chat world from various sources:', {
                fromImport: chat_metadata?.[METADATA_KEY],
                fromContext: this.getContext?.()?.chat_metadata?.[METADATA_KEY],
                fromWindow: window.chat_metadata?.[METADATA_KEY],
                final: chatWorld
            });
            
            if (!chatWorld) {
                this.toastr?.warning('当前聊天没有绑定的世界书');
                return;
            }
            
            // 直接执行，不需要确认
            
            // 加载世界书数据
            const worldData = await loadWorldInfo(chatWorld);
            if (!worldData || !worldData.entries) {
                this.toastr?.error('无法加载世界书数据');
                return;
            }
            
            // 获取所有有效条目（不筛选，但排除禁用的条目）
            const validEntries = Object.values(worldData.entries).filter(entry => 
                !entry.disable && entry.content && entry.content.trim()
            );
            
            if (validEntries.length === 0) {
                this.toastr?.warning('世界书中没有有效条目');
                return;
            }
            
            // 准备向量化的内容
            const contentToVectorize = validEntries.map(entry => ({
                uid: entry.uid,
                world: chatWorld,
                key: entry.key,
                keysecondary: entry.keysecondary,
                comment: entry.comment,
                content: entry.content,
                order: entry.order,
                position: entry.position,
                disable: entry.disable
            }));
            
            // 调用向量化功能
            const settings = extension_settings.vectors_enhanced;
            
            // 创建一个特殊的向量化任务
            const taskName = `${chatWorld} - 世界书向量化`;
            const taskId = `worldbook_${Date.now()}`;
            
            // 触发向量化
            const event = new CustomEvent('vectors:vectorize-summary', {
                detail: {
                    taskName,
                    taskId,
                    content: contentToVectorize,
                    worldName: chatWorld
                }
            });
            document.dispatchEvent(event);
            
            this.toastr?.info(`开始向量化世界书 "${chatWorld}"，共 ${validEntries.length} 个条目...`);
            
        } catch (error) {
            console.error('[MemoryUI] 向量化总结失败:', error);
            this.toastr?.error('向量化总结失败: ' + error.message);
        }
    }

    /**
     * 迁移旧的 lastSummarizedFloor 数据
     */
    migrateLastSummarizedFloor() {
        try {
            // 检查是否已有聊天元数据中的值
            const existingValue = this.getFromChatMetadata('lastSummarizedFloor');
            
            // 如果已经有值，说明已经迁移过或是新的数据，不需要处理
            if (existingValue !== undefined) {
                console.log('[MemoryUI] lastSummarizedFloor already exists in chat metadata:', existingValue);
                return;
            }
            
            // 检查全局设置中是否有旧数据
            const globalValue = this.settings?.memory?.autoSummarize?.lastSummarizedFloor;
            
            if (globalValue && globalValue > 0) {
                // 获取当前聊天的上下文
                const context = this.getContext ? this.getContext() : window.getContext?.();
                const currentFloor = context?.chat?.length - 1 || 0;
                
                // 只有当全局值合理时才迁移（不能大于当前楼层）
                if (globalValue <= currentFloor) {
                    console.log('[MemoryUI] Migrating lastSummarizedFloor from global settings:', globalValue);
                    this.saveToChatMetadata('lastSummarizedFloor', globalValue);
                } else {
                    // 如果全局值不合理，不初始化（让它保持undefined，这样会使用0）
                    console.log('[MemoryUI] Global lastSummarizedFloor is invalid, not migrating');
                }
            } else {
                // 没有旧数据，不需要初始化（让它保持undefined）
                console.log('[MemoryUI] No existing lastSummarizedFloor to migrate');
            }
        } catch (error) {
            console.error('[MemoryUI] Error during migration:', error);
            // 出错时不做处理，让它保持undefined
        }
    }

    /**
     * Initialize chat floor monitor
     */
    initializeChatFloorMonitor() {
        // 立即更新一次
        this.updateChatFloorCount();
        
        // 执行数据迁移
        this.migrateLastSummarizedFloor();
        
        // 监听SillyTavern的消息事件
        if (this.eventSource && this.event_types) {
            // 监听消息发送事件
            this.eventSource.on(this.event_types.MESSAGE_SENT, () => {
                setTimeout(() => this.updateChatFloorCount(), 100);
            });
            
            // 监听消息接收事件
            this.eventSource.on(this.event_types.MESSAGE_RECEIVED, () => {
                setTimeout(() => {
                    this.updateChatFloorCount();
                    this.checkAutoSummarize();  // 检查是否需要自动总结
                }, 100);
            });
            
            // 监听消息删除事件
            this.eventSource.on(this.event_types.MESSAGE_DELETED, () => {
                setTimeout(() => this.updateChatFloorCount(), 100);
            });
            
            // 监听消息编辑事件
            this.eventSource.on(this.event_types.MESSAGE_EDITED, () => {
                setTimeout(() => this.updateChatFloorCount(), 100);
            });
            
            // 监听聊天切换事件
            this.eventSource.on(this.event_types.CHAT_CHANGED, () => {
                console.log('[MemoryUI] Chat changed event fired');
                setTimeout(() => {
                    this.migrateLastSummarizedFloor();  // 执行迁移
                    this.updateChatFloorCount();
                    this.updateAutoSummarizeStatus();
                }, 100);
            });
            
            // 监听聊天加载事件
            this.eventSource.on(this.event_types.CHAT_LOADED, () => {
                console.log('[MemoryUI] Chat loaded event fired');
                setTimeout(() => {
                    this.migrateLastSummarizedFloor();  // 执行迁移
                    this.updateChatFloorCount();
                    this.updateAutoSummarizeStatus();
                }, 100);
            });
        }
    }
    
    /**
     * Update chat floor count display
     */
    updateChatFloorCount() {
        try {
            const context = this.getContext ? this.getContext() : getContext();
            const floorElement = $('#memory_chat_floor_count');
            
            if (!context || !context.chat) {
                floorElement.text('无聊天');
                return;
            }
            
            const chat = context.chat;
            const totalMessages = chat.length;
            
            // 计算实际可见的消息数（排除系统消息）
            const visibleMessages = chat.filter(msg => !msg.is_system).length;
            
            // 获取最新消息的楼层号（基于索引）
            const latestFloor = totalMessages > 0 ? totalMessages - 1 : 0;
            
            // 显示格式：楼层 #N (共M条)
            if (visibleMessages === totalMessages) {
                floorElement.text(`楼层 #${latestFloor + 1} (共${totalMessages}条)`);
            } else {
                floorElement.text(`楼层 #${latestFloor + 1} (${visibleMessages}/${totalMessages}条)`);
            }
            
            // 添加颜色提示：如果消息数量较多
            if (totalMessages > 100) {
                floorElement.css('color', 'var(--warning)');
                floorElement.attr('title', '消息数量较多，考虑总结部分内容以提高性能');
            } else if (totalMessages > 50) {
                floorElement.css('color', 'var(--SmartThemeQuoteColor)');
                floorElement.attr('title', '消息数量适中');
            } else {
                floorElement.css('color', 'var(--SmartThemeEmColor)');
                floorElement.attr('title', '当前聊天楼层信息');
            }
            
        } catch (error) {
            console.error('[MemoryUI] 更新聊天楼层失败:', error);
            $('#memory_chat_floor_count').text('错误');
        }
    }

    /**
     * Update auto-summarize status display
     */
    async updateAutoSummarizeStatus() {
        const interval = parseInt($('#memory_auto_summarize_interval').val()) || 20;
        const context = this.getContext ? this.getContext() : getContext();

        if (!context || !context.chat) {
            $('#memory_next_auto_summarize_floor').text('-');
            return;
        }

        const currentFloor = context.chat.length - 1;
        const chatId = context.chatId || 'unknown';

        // 获取上次总结的楼层（包含世界书同步逻辑）
        const lastSummarized = await this.getLastSummarizedFloor();

        // 智能初始化处理：如果lastSummarized为0，尝试智能初始化
        if (lastSummarized === 0 && this.settings?.memory?.autoSummarize?.enabled) {
            console.log('[MemoryUI] updateAutoSummarizeStatus: 检测到lastSummarized为0，尝试智能初始化');
            const smartLastFloor = await this.getSmartLastSummarizedFloor(currentFloor, interval);

            if (smartLastFloor > 0) {
                console.log(`[MemoryUI] 智能初始化：找到历史总结最大楼层 ${smartLastFloor}，使用该值作为基准`);
                this.saveToChatMetadata('lastSummarizedFloor', smartLastFloor);
                const nextFloor = smartLastFloor + interval;
                $('#memory_next_auto_summarize_floor').text(`#${nextFloor + 1}`);
                return;
            } else {
                console.log('[MemoryUI] updateAutoSummarizeStatus: 未找到历史总结，初始化为当前楼层', currentFloor);
                this.saveToChatMetadata('lastSummarizedFloor', currentFloor);
                const nextFloor = currentFloor + interval;
                $('#memory_next_auto_summarize_floor').text(`#${nextFloor + 1}`);
                return;
            }
        }

        // 获取实际最后总结的楼层（lastSummarized - 1）
        // 因为 lastSummarized 存储的是下次开始的索引
        const lastActualFloor = lastSummarized - 1;

        // 基于最后总结的楼层计算下次触发
        const nextFloor = lastActualFloor + interval;

        console.log('[MemoryUI] updateAutoSummarizeStatus:', {
            chatId,
            currentFloor,
            interval,
            lastSummarized,
            lastActualFloor,
            nextFloor,
            nextFloorDisplay: nextFloor + 1,
            syncEnabled: $('#memory_auto_sync_world_info').prop('checked')
        });

        $('#memory_next_auto_summarize_floor').text(`#${nextFloor + 1}`);
    }
    
    /**
     * 智能获取上次总结的楼层
     * 根据当前楼层和间隔，智能计算应该从哪个楼层开始计数
     */
    async getSmartLastSummarizedFloor(currentFloor, interval) {
        try {
            // 尝试从世界书获取历史总结
            let chatWorld = this.getBoundWorldBook();

            // 如果没有绑定的世界书，尝试自动绑定
            if (!chatWorld) {
                const worldBooks = await this.getAvailableWorldBooks();
                if (worldBooks.length > 0) {
                    // 优先查找包含楼层信息的特定世界书
                    const targetWorldBook = worldBooks.find(name =>
                        name.includes('我的青春恋爱物语没有问题') &&
                        (name.includes('251202') || name.includes('1725'))
                    );

                    if (targetWorldBook) {
                        chatWorld = targetWorldBook;
                        console.log(`[MemoryUI] getSmartLastSummarizedFloor: 找到匹配的楼层世界书: ${chatWorld}`);
                    } else {
                        chatWorld = worldBooks[0];
                        console.log(`[MemoryUI] getSmartLastSummarizedFloor: 使用第一个可用世界书: ${chatWorld}`);
                    }

                    // 自动绑定这个世界书
                    this.bindWorldBook(chatWorld);
                }
            }

            if (!chatWorld) {
                console.log('[MemoryUI] getSmartLastSummarizedFloor: 没有可用的世界书');
                return 0;
            }

            const worldData = await loadWorldInfo(chatWorld);
            if (!worldData || !worldData.entries) {
                console.log('[MemoryUI] getSmartLastSummarizedFloor: 无法加载世界书数据');
                return 0;
            }

            // 收集所有总结的楼层范围
            const summaryRanges = [];

            Object.values(worldData.entries).forEach(entry => {
                const textToSearch = (entry.comment || '') + ' ' + (entry.key ? entry.key.join(' ') : '');

                // 匹配楼层 #0-4 格式
                const match = textToSearch.match(/楼层\s+#(\d+)(?:-(\d+))?/);
                if (match) {
                    const startFloor = parseInt(match[1], 10);
                    const endFloor = match[2] ? parseInt(match[2], 10) : startFloor;
                    summaryRanges.push({ startFloor, endFloor });
                }
            });

            if (summaryRanges.length === 0) {
                console.log('[MemoryUI] getSmartLastSummarizedFloor: 世界书中没有找到楼层总结记录');
                return 0;
            }

            // 找到最大的结束楼层
            const maxEndFloor = Math.max(...summaryRanges.map(r => r.endFloor));
            console.log(`[MemoryUI] getSmartLastSummarizedFloor: 找到历史总结，最大结束楼层: ${maxEndFloor}`);

            // maxEndFloor 是已总结的最后一层（例如4表示总结到第4层）
            // 下次总结应该从 maxEndFloor + 1 开始
            const lastSummarizedFloor = maxEndFloor + 1;
            console.log(`[MemoryUI] getSmartLastSummarizedFloor: 下次开始楼层: ${lastSummarizedFloor}`);

            // 计算下一个触发点
            // 例如：如果上次总结到第4层，间隔12，那么应该在16触发（总结5-16层）
            let nextTriggerFloor = lastSummarizedFloor;

            // 找到离当前楼层最近且不超过当前楼层的触发点
            while (nextTriggerFloor + interval <= currentFloor) {
                nextTriggerFloor += interval;
            }

            console.log(`[MemoryUI] getSmartLastSummarizedFloor: 计算结果 - 最大结束楼层: ${maxEndFloor}, 下次开始: ${lastSummarizedFloor}, 当前楼层: ${currentFloor}, 间隔: ${interval}, 下次触发楼层: ${nextTriggerFloor}`);

            return lastSummarizedFloor;

        } catch (error) {
            console.error('[MemoryUI] getSmartLastSummarizedFloor: 计算智能楼层时出错:', error);
            return 0;
        }
    }

    /**
     * 获取所有可用的世界书列表
     */
    async getAvailableWorldBooks() {
        try {
            const entries = await getSortedEntries();
            const worldBooks = new Set();

            entries.forEach(entry => {
                if (entry.world && !entry.disable) {
                    worldBooks.add(entry.world);
                }
            });

            console.log('[MemoryUI] getAvailableWorldBooks: 可用的世界书:', Array.from(worldBooks));
            return Array.from(worldBooks);
        } catch (error) {
            console.error('[MemoryUI] getAvailableWorldBooks: 获取世界书列表失败:', error);
            return [];
        }
    }

    /**
     * 确保有绑定的世界书
     */
    async ensureWorldBookBound() {
        let chatWorld = this.getBoundWorldBook();

        if (!chatWorld) {
            const worldBooks = await this.getAvailableWorldBooks();
            console.log('[MemoryUI] ensureWorldBookBound: 可用的世界书列表:', worldBooks);

            if (worldBooks.length > 0) {
                // 优先查找包含楼层信息的特定世界书
                const targetWorldBook = worldBooks.find(name =>
                    name.includes('我的青春恋爱物语没有问题') &&
                    (name.includes('251202') || name.includes('1725'))
                );

                if (targetWorldBook) {
                    chatWorld = targetWorldBook;
                    console.log(`[MemoryUI] ensureWorldBookBound: 找到匹配的楼层世界书: ${chatWorld}`);
                } else {
                    chatWorld = worldBooks[0];
                    console.log(`[MemoryUI] ensureWorldBookBound: 选择第一个可用世界书: ${chatWorld}`);
                }

                console.log('[MemoryUI] ensureWorldBookBound: 正在绑定世界书...');
                this.bindWorldBook(chatWorld);
                return chatWorld;
            }
        }

        return chatWorld;
    }

    /**
     * 绑定世界书到当前对话
     */
    bindWorldBook(worldBookName) {
        try {
            // 确保 window.chat_metadata 存在
            if (!window.chat_metadata) {
                window.chat_metadata = {};
            }

            // 设置世界书绑定
            window.chat_metadata[METADATA_KEY] = worldBookName;

            // 也更新导入的 chat_metadata（如果存在）
            if (chat_metadata) {
                chat_metadata[METADATA_KEY] = worldBookName;
            }

            // 尝试获取 context 并更新
            const context = this.getContext?.();
            if (context && context.chat_metadata) {
                context.chat_metadata[METADATA_KEY] = worldBookName;
            }

            // 保存 metadata
            if (typeof saveMetadata === 'function') {
                saveMetadata();
            }

            console.log(`[MemoryUI] 已绑定世界书 "${worldBookName}" 到当前对话`);
            console.log(`[MemoryUI] window.chat_metadata:`, window.chat_metadata);

            // 更新UI按钮状态
            if (window.$) {
                window.$('.chat_lorebook_button').addClass('world_set');
            }

            return true;
        } catch (error) {
            console.error('[MemoryUI] 绑定世界书失败:', error);
            return false;
        }
    }

    /**
     * Reset auto-summarize base floor to current floor
     */
    async resetAutoSummarize() {
        const context = this.getContext ? this.getContext() : getContext();
        
        if (!context || !context.chat) {
            this.toastr?.warning('无法重置：聊天上下文不可用');
            return;
        }

        const syncEnabled = $('#memory_auto_sync_world_info').prop('checked') || 
                           this.settings?.memory?.autoSummarize?.syncWorldInfo || false;
        
        // 如果启用了同步，则强制从世界书同步
        if (syncEnabled) {
            console.log('[MemoryUI] 重置自动总结：强制从世界书同步进度');
            const lastSummarized = await this.getLastSummarizedFloor(true);
            
            this.updateAutoSummarizeStatus();
            
            const interval = parseInt($('#memory_auto_summarize_interval').val()) || 20;
            const nextFloor = (lastSummarized - 1) + interval;
            
            if (lastSummarized > 0) {
                this.toastr?.success(`已同步世界书进度！下次将在楼层 #${nextFloor + 1} 触发总结`);
            } else {
                this.toastr?.info(`已重置（未在世界书中发现进度），下次将在楼层 #${nextFloor + 1} 触发总结`);
            }
            return;
        }
        
        // 否则执行原逻辑：重置为当前楼层
        const currentFloor = context.chat.length - 1;
        
        // 保存当前楼层作为新的基准点
        console.log('[MemoryUI] 重置自动总结基准点为当前楼层:', currentFloor);
        this.saveToChatMetadata('lastSummarizedFloor', currentFloor);
        
        // 更新UI显示
        this.updateAutoSummarizeStatus();
        
        // 显示成功提示
        const interval = parseInt($('#memory_auto_summarize_interval').val()) || 20;
        const nextFloor = currentFloor + interval;
        this.toastr?.success(`已重置！下次将在楼层 #${nextFloor + 1} 触发总结`);
    }
    
    /**
     * Check if auto-summarize should be triggered
     */
    async checkAutoSummarize() {
        try {
            // 检查主开关是否启用
            if (!this.settings?.master_enabled) {
                console.log('[MemoryUI] 主开关已禁用，跳过自动总结检查');
                return;
            }
            
            // 检查是否已有自动总结在进行中
            if (this.isAutoSummarizing) {
                console.log('[MemoryUI] 自动总结已在进行中，跳过本次触发');
                return;
            }
            
            // 检查是否启用自动总结
            if (!this.settings?.memory?.autoSummarize?.enabled) {
                console.log('[MemoryUI] 自动总结未启用');
                return;
            }
            
            const context = this.getContext ? this.getContext() : getContext();
            if (!context || !context.chat || context.chat.length < 2) {
                console.log('[MemoryUI] 聊天上下文不可用或消息太少');
                return;
            }
            
            const currentFloor = context.chat.length - 1;
            const interval = parseInt($('#memory_auto_summarize_interval').val()) || 20;
            const keepCount = parseInt($('#memory_auto_summarize_count').val()) || 6;
            
            // 获取上次总结的楼层（包含世界书同步逻辑）
            let lastSummarized = await this.getLastSummarizedFloor();
            
            // 兼容性处理：如果lastSummarized为0，说明是旧版本用户或新用户
            // 初始化为当前楼层，避免立即触发
            if (lastSummarized === 0) {
                console.log('[MemoryUI] 检测到lastSummarized为0，初始化为当前楼层:', currentFloor);
                this.saveToChatMetadata('lastSummarizedFloor', currentFloor);
                lastSummarized = currentFloor;
                // 初始化后本次不触发，等待下次检查
                return;
            }
            
            console.log('[MemoryUI] 自动总结检查:', {
                currentFloor,
                interval,
                keepCount,
                lastSummarized,
                enabled: this.settings?.memory?.autoSummarize?.enabled
            });
            
            // 简化后的触发条件：基于最后总结的楼层计算
            const nextTriggerFloor = (lastSummarized - 1) + interval;
            
            // 当前楼层必须达到或超过下次触发楼层才触发
            if (currentFloor < nextTriggerFloor) {
                console.log('[MemoryUI] 未达到触发楼层，不触发', {
                    currentFloor,
                    lastSummarized,
                    nextTriggerFloor,
                    interval,
                    needMore: nextTriggerFloor - currentFloor
                });
                return;
            }
            
            // 检查最新消息是否为AI回复
            const latestMessage = context.chat[currentFloor];
            if (!latestMessage || latestMessage.is_user) {
                console.log('[MemoryUI] 最新消息不是AI回复，不触发');
                return;
            }
            
            console.log('[MemoryUI] 触发自动总结:', {
                currentFloor,
                interval,
                keepCount,
                lastSummarized,
                nextTriggerFloor
            });
            
            // 设置标志，防止并发执行
            this.isAutoSummarizing = true;
            
            // 执行自动总结
            await this.performAutoSummarize(currentFloor, keepCount);
            
        } catch (error) {
            console.error('[MemoryUI] 自动总结检查失败:', error);
            // 如果检查过程出错，也要清除标志
            this.isAutoSummarizing = false;
        }
    }
    
    /**
     * Perform auto-summarization
     */
    async performAutoSummarize(currentFloor, keepCount) {
        try {
            console.log('[MemoryUI] performAutoSummarize 开始执行', { currentFloor, keepCount });
            
            // 导入必要的函数和工具
            const { extension_settings, getContext } = await import('../../../../../../extensions.js');
            const { getMessages, createVectorItem } = await import('../../utils/chatUtils.js');
            const { extractTagContent } = await import('../../utils/tagExtractor.js');
            
            const settings = extension_settings.vectors_enhanced;
            const context = getContext();
            
            // 检查主开关是否启用
            if (!settings.master_enabled) {
                console.log('[MemoryUI] 主开关已禁用，跳过自动总结');
                return;
            }
            
            this.toastr?.info('开始自动总结...');
            
            // 获取标签提取规则（如果有的话）
            const rules = settings.tag_extraction_rules || [];
            
            // 确保保留数量至少为1
            const actualKeepCount = Math.max(1, keepCount);
            
            // 获取步进间隔
            const interval = parseInt($('#memory_auto_summarize_interval').val()) || 20;

            // 计算要总结的范围
            // currentFloor是当前楼层（从0开始）
            // actualKeepCount是要保留的层数
            // 上次总结的位置（包含世界书同步逻辑）
            const lastSummarized = await this.getLastSummarizedFloor();
            
            // 总结范围起点
            const startIndex = lastSummarized;
            
            // 智能追赶逻辑：
            // 计算按照固定步进的理想终点
            // 例如：start=5, interval=10 -> target=14 (5,6,...14 共10层)
            const targetEndIndex = startIndex + interval - 1;
            
            // 计算实际允许的最大总结点（保留最新 keepCount 条）
            const maxAllowedIndex = currentFloor - actualKeepCount;
            
            // 最终决定终点
            // 如果目标终点超过了允许范围，说明不够凑齐一个周期，应该等待
            // 除非启用了"强制同步"或其他逻辑，这里我们坚持"整周期总结"原则以保持一致性
            if (targetEndIndex > maxAllowedIndex) {
                console.log('[MemoryUI] 消息数量不足一个完整周期，等待更多消息', {
                    startIndex,
                    targetEndIndex,
                    maxAllowedIndex,
                    interval
                });
                // 静默返回，不显示警告，因为这在追赶模式下是正常的停止条件
                return;
            }
            
            const endIndex = targetEndIndex;
            
            if (endIndex <= startIndex) {
                console.log('[MemoryUI] 范围计算异常', { startIndex, endIndex });
                return;
            }

            // ---------------------------------------------------------
            // 自动向量化处理
            // ---------------------------------------------------------
            // 检查设置是否启用了自动向量化（默认为true）
            const autoVectorizeEnabled = settings.memory?.autoSummarize?.autoVectorize !== false;
            
            if (this.performVectorization && autoVectorizeEnabled) {
                 try {
                    // 获取范围内所有消息（用户+AI）
                    const vectorizeOptions = {
                        includeHidden: true, // 包含可能已经被标记为隐藏的消息
                        types: { user: true, assistant: true },
                        range: { start: startIndex, end: endIndex }
                    };
                    const messagesToVectorize = getMessages(context.chat, vectorizeOptions);
                    
                    if (messagesToVectorize.length > 0) {
                        this.toastr?.info(`正在自动向量化楼层 #${startIndex + 1} 至 #${endIndex + 1} ...`);
                        console.log('[MemoryUI] 开始自动向量化范围:', startIndex, endIndex);

                        const items = messagesToVectorize.map(msg => {
                             let extractedText = msg.text;
                             // 应用标签提取规则 (如果不是首楼且不是用户消息)
                             if (msg.index !== 0 && !msg.is_user && rules && rules.length > 0) {
                                 extractedText = extractTagContent(msg.text, rules, settings.content_blacklist || []);
                             }
                             
                             return createVectorItem(msg, extractedText, extractedText);
                        });

                        // 构造特殊的任务名
                        const taskName = `自动向量化 #${startIndex + 1}-${endIndex + 1}`;
                        
                        // 调用向量化 (isIncremental=true)
                        await this.performVectorization(
                            settings.selected_content, 
                            context.chatId, 
                            true, 
                            items, 
                            { 
                                taskType: 'auto_vectorization',
                                customTaskName: taskName,
                                skipDeduplication: false
                            }
                        );
                        
                        console.log('[MemoryUI] 自动向量化完成');
                    }
                 } catch (vecError) {
                     console.error('[MemoryUI] 自动向量化失败:', vecError);
                     this.toastr?.error('自动向量化失败: ' + vecError.message);
                     // 不中断总结流程
                 }
            }
            // ---------------------------------------------------------
            
            // 收集要总结的AI消息
            const aiMessages = [];
            
            // 从startIndex开始，到endIndex结束（包含），收集所有AI消息
            for (let i = startIndex; i <= endIndex; i++) {
                const msg = context.chat[i];
                if (msg && !msg.is_user && !msg.is_system) {
                    // 这是AI消息
                    aiMessages.push({
                        ...msg,
                        index: i
                    });
                }
            }
            
            console.log('[MemoryUI] 收集到的AI消息数量:', aiMessages.length);
            
            if (aiMessages.length === 0) {
                console.log('[MemoryUI] 没有找到AI消息');
                this.toastr?.warning('没有找到足够的AI消息进行总结');
                return;
            }
            
            // 调试：显示收集到的消息
            console.log('[MemoryUI] 收集到的AI消息详情:', aiMessages.map(msg => ({
                index: msg.index,
                hasText: !!msg.text,
                hasMes: !!msg.mes,
                textLength: (msg.text || '').length,
                mesLength: (msg.mes || '').length
            })));
            
            // 处理并格式化AI消息
            const chatTexts = aiMessages.map(msg => {
                // 获取消息文本（SillyTavern使用mes属性）
                const messageText = msg.mes || msg.text || '';
                
                if (!messageText) {
                    console.warn(`[MemoryUI] 楼层 #${msg.index + 1} 的AI消息为空`);
                    return `#${msg.index + 1} [AI]: （空消息）`;
                }
                
                // 对AI消息应用标签提取规则
                const extractedText = extractTagContent(messageText, rules, this.settings.content_blacklist || []);
                return `#${msg.index + 1} [AI]: ${extractedText}`;
            }).join('\n\n');
            
            // 添加楼层信息头部
            const headerInfo = `【自动总结：楼层 #${startIndex + 1} 至 #${endIndex + 1}，共 ${aiMessages.length} 条AI消息】\n\n`;
            const contentWithHeader = headerInfo + chatTexts;
            
            // 调试：检查最终内容
            console.log('[MemoryUI] 准备发送的内容长度:', contentWithHeader.length);
            console.log('[MemoryUI] 内容预览:', contentWithHeader.substring(0, 200) + '...');
            
            // 获取API配置
            const apiSource = $('#memory_api_source').val();
            const apiConfig = this.getApiConfig();
            let summaryFormat = $('#memory_summary_format').val() || this.settings.memory?.summaryFormat || defaultMemorySettings.summaryFormat;
            const detailLevel = $('#memory_detail_level').val() || this.settings.memory?.detailLevel || defaultMemorySettings.detailLevel;
            summaryFormat = summaryFormat.replace('{{length}}', detailLevels[detailLevel]);
            
            // 临时存储楼层信息
            this._tempFloorRange = { 
                start: startIndex, 
                end: endIndex, 
                count: aiMessages.length,
                isAutoSummarize: true,
                isAIOnly: true  // 标记这是仅AI消息的总结
            };
            
            console.log('[MemoryUI] 准备调用memoryService.sendMessage', {
                contentLength: contentWithHeader.length,
                apiSource,
                apiConfig,
                summaryFormat: summaryFormat.substring(0, 100) + '...',
                hasApiKey: !!apiConfig.apiKey,
                apiUrl: apiConfig.url || 'N/A'
            });
            
            // 检查API配置
            if (!apiConfig.apiKey && apiSource !== 'main_api') {
                console.error('[MemoryUI] API密钥未设置');
                this.toastr?.error('请先配置API密钥');
                return;
            }
            
            // 执行总结
            console.log('[MemoryUI] 调用memoryService.sendMessage前');
            const maxTokens = parseInt($('#memory_max_tokens').val()) || this.settings.memory?.maxTokens || defaultMemorySettings.maxTokens;
            const result = await this.memoryService.sendMessage(contentWithHeader, {
                apiSource: apiSource,
                apiConfig: apiConfig,
                summaryFormat: summaryFormat,
                maxTokens: maxTokens
            });
            console.log('[MemoryUI] memoryService.sendMessage返回:', result);
            
            if (result && result.success) {
                // 检查响应内容是否有效
                const response = result.response || '';
                
                // 检查是否为空或太短
                if (!response || response.trim().length < 2) {
                    console.error('[MemoryUI] 自动总结返回空内容');
                    // 确保错误提示能显示
                    setTimeout(() => {
                        if (this.toastr) {
                            this.toastr.error('自动总结失败：AI返回了空内容', '总结失败', {
                                timeOut: 5000,
                                extendedTimeOut: 2000,
                                preventDuplicates: true
                            });
                        } else {
                            alert('自动总结失败：AI返回了空内容');
                        }
                    }, 100);
                    this.hideLoading();
                    return;
                }
                
                // 检查是否包含错误标记（常见的错误响应）
                const errorKeywords = ['error', 'Error', 'ERROR', '错误', '失败', 'failed', 'Failed'];
                const lowerResponse = response.toLowerCase();
                const isError = errorKeywords.some(keyword => 
                    lowerResponse.includes(keyword.toLowerCase()) && response.length < 100
                );
                
                if (isError) {
                    console.error('[MemoryUI] 自动总结可能返回了错误:', response);
                    this.toastr?.warning('自动总结可能失败：' + response.substring(0, 50) + '...');
                }
                
                // 更新最后总结的楼层为endIndex+1（下次从这里开始）
                // 保存到聊天元数据而不是全局设置
                this.saveToChatMetadata('lastSummarizedFloor', endIndex + 1);
                
                this.toastr?.success(`自动总结完成：楼层 #${startIndex + 1} 至 #${endIndex + 1}`);
                this.updateAutoSummarizeStatus();
                
                // 检查是否需要隐藏楼层
                await this.hideFloorsIfEnabled(startIndex, endIndex, true);
            } else {
                // 处理失败情况
                console.error('[MemoryUI] 自动总结返回失败:', result);
                this.toastr?.error('自动总结失败：' + (result?.error || '未知错误'));
                this.hideLoading();
            }
            
        } catch (error) {
            console.error('[MemoryUI] 自动总结失败:', error);
            console.error('[MemoryUI] 错误堆栈:', error.stack);
            this.toastr?.error('自动总结失败: ' + error.message);
            
            // 如果失败了，也要显示加载完成
            this.hideLoading();
                    } finally {
                        // 无论成功还是失败，都要清除标志
                        this.isAutoSummarizing = false;
                        console.log('[MemoryUI] 自动总结完成，清除并发标志');
        
                        // 智能追赶：如果还有“欠账”，自动再次触发检查
                        // 确保在最后一步处理，且只在成功或特定情况下追赶
                        if (result?.success && this.settings?.memory?.autoSummarize?.enabled) {
                            const latestLastSummarized = await this.getLastSummarizedFloor(); // 获取最新的已总结楼层
                            const interval = parseInt($('#memory_auto_summarize_interval').val()) || 20;
                            const keepCount = parseInt($('#memory_auto_summarize_count').val()) || 6;
                            const context = getContext();
                            const currentFloor = context.chat.length - 1;
                            const maxAllowedIndex = currentFloor - keepCount;
        
                            // 计算下一个周期应该开始的楼层
                            const nextCycleStart = latestLastSummarized; // 因为 latestLastSummarized 已经是 nextStartIndex
                            const nextCycleEnd = nextCycleStart + interval - 1;
        
                            if (nextCycleEnd <= maxAllowedIndex) {
                                console.log('[MemoryUI] 检测到还有未总结的周期，将在短时间后继续追赶...', { nextCycleStart, nextCycleEnd, maxAllowedIndex });
                                setTimeout(() => this.checkAutoSummarize(), 500); // 稍作延迟再次检查
                            } else {
                                console.log('[MemoryUI] 已追赶到最新进度附近，等待新消息触发下一个周期');
                            }
                        }
                    }    }

    /**
     * Hide floors if enabled in settings
     * @param {number} startIndex - Start index of AI messages
     * @param {number} endIndex - End index of AI messages
     * @param {boolean} isAutoSummarize - Whether this is from auto-summarize
     */
    async hideFloorsIfEnabled(startIndex, endIndex, isAutoSummarize) {
        try {
            // 检查是否启用了隐藏楼层功能
            const hideEnabled = $('#memory_hide_floors_after_summary').prop('checked');
            if (!hideEnabled) {
                console.log('[MemoryUI] 隐藏楼层功能未启用');
                return;
            }
            
            // 使用注入的依赖
            const context = this.getContext();
            
            if (!context || !context.chat) {
                console.error('[MemoryUI] 无法获取聊天上下文');
                return;
            }
            
            // 找出需要隐藏的消息范围
            // 需要包含startIndex和endIndex之间的所有用户消息
            let hideCount = 0;
            const messagesToHide = [];
            
            // 遍历聊天记录，找出需要隐藏的消息
            for (let i = 0; i < context.chat.length; i++) {
                const msg = context.chat[i];
                
                // 如果是AI消息且在总结范围内
                if (!msg.is_user && i >= startIndex && i <= endIndex) {
                    messagesToHide.push(i);
                }
                
                // 如果是用户消息且在总结范围内（包括边界）
                // 例如：总结了5-10楼的AI消息，也要隐藏4-10之间的用户消息
                if (msg.is_user && i >= Math.max(0, startIndex - 1) && i <= endIndex) {
                    messagesToHide.push(i);
                }
            }
            
            console.log('[MemoryUI] 准备隐藏的消息索引:', messagesToHide);
            
            // 批量隐藏消息
            for (const index of messagesToHide) {
                context.chat[index].is_system = true;
                hideCount++;
            }
            
            if (hideCount > 0) {
                // 保存聊天记录
                if (this.saveChatConditional) {
                    await this.saveChatConditional();
                } else {
                    console.error('[MemoryUI] saveChatConditional not available');
                }
                
                // 触发UI更新
                const eventSource = this.eventSource;
                const event_types = this.event_types;
                if (eventSource && event_types) {
                    eventSource.emit(event_types.CHAT_CHANGED);
                }
                
                // 重新加载当前聊天以立即显示隐藏标志
                if (context.reloadCurrentChat && typeof context.reloadCurrentChat === 'function') {
                    await context.reloadCurrentChat();
                }
                
                // 更新隐藏消息信息显示
                // 注意：这里可能需要在将来添加MessageUI的依赖注入
                if (window.MessageUI && typeof window.MessageUI.updateHiddenMessagesInfo === 'function') {
                    window.MessageUI.updateHiddenMessagesInfo();
                } else {
                    console.log('[MemoryUI] MessageUI.updateHiddenMessagesInfo not available');
                }
                
                this.toastr?.info(`已隐藏 ${hideCount} 条消息`);
                console.log(`[MemoryUI] 成功隐藏 ${hideCount} 条消息`);
            }
            
        } catch (error) {
            console.error('[MemoryUI] 隐藏楼层失败:', error);
            this.toastr?.error('隐藏楼层失败: ' + error.message);
        }
    }

    /**
     * Reset summary format to default
     */
    resetSummaryFormat() {
        const defaultFormat = `总结应当遵循以下原则：
- 按时间顺序或逻辑顺序组织信息
- 保留关键事件和重要细节，省略冗余描述
- 直接陈述事实，避免主观评价
- 使用简洁清晰的语言，避免过度修饰
- 突出事件发展脉络和关键转折点
- 不使用任何xml标签包裹，使用纯文字进行叙述
- {{length}}
- 不回避任何敏感内容，保证记录完全还原前文

总结必须使用以下格式：
【关键事件标题】
关键事件概述。
发生地点:
关键角色:
• {分解事件1（小标题形式）}: {简要描述}
• {分解事件2（小标题形式）}: {简要描述}
• {分解事件3（小标题形式）}: {简要描述}
...`;
        
        $('#memory_summary_format').val(defaultFormat);
        this.saveApiConfig();
        
        // Show feedback
        if (this.toastr) {
            this.toastr.success('已重置为默认总结格式');
        }
    }

    destroy() {
        // Unbind event listeners
        $('#memory_summarize_btn').off('click');
        $('#memory_api_source').off('change');
        $('#memory_vectorize_summary').off('click');
        // Prompt buttons removed
        $('#memory_openai_url, #memory_openai_api_key, #memory_openai_model, #memory_google_openai_api_key, #memory_google_openai_model, #memory_summary_format, #memory_detail_level, #memory_max_tokens').off('change');

        // Unsubscribe from events
        if (this.eventBus) {
            this.eventBus.off('memory:message-start');
            this.eventBus.off('memory:message-complete');
            this.eventBus.off('memory:message-error');
            this.eventBus.off('memory:history-updated');
        }
        
        // Unsubscribe from SillyTavern events
        if (this.eventSource && this.event_types) {
            this.eventSource.off(this.event_types.MESSAGE_SENT);
            this.eventSource.off(this.event_types.MESSAGE_RECEIVED);
            this.eventSource.off(this.event_types.MESSAGE_DELETED);
            this.eventSource.off(this.event_types.MESSAGE_EDITED);
            this.eventSource.off(this.event_types.CHAT_CHANGED);
            this.eventSource.off(this.event_types.CHAT_LOADED);
        }

        this.initialized = false;
    }

}
