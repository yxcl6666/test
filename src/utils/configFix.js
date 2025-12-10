// 配置修复脚本 - 修复向量化配置命名不一致问题

// 1. 确保配置从UI正确读取
function loadVectorizationSettings() {
    const settings = extension_settings.vectors_enhanced;

    // 从UI读取配置
    const chunkSize = $('#vectors_enhanced_chunk_size').val();
    const overlapPercent = $('#vectors_enhanced_overlap_percent').val();

    // 确保使用正确的字段名（下划线命名）
    if (chunkSize && !settings.chunk_size) {
        settings.chunk_size = parseInt(chunkSize) || 1000;
    }

    if (overlapPercent && !settings.overlap_percent) {
        settings.overlap_percent = parseInt(overlapPercent) || 10;
    }

    console.log('[VectorizationSettings] 加载配置:', {
        chunk_size: settings.chunk_size,
        overlap_percent: settings.overlap_percent
    });

    return settings;
}

// 2. 保存配置时确保使用正确的字段名
function saveVectorizationSettings() {
    const settings = extension_settings.vectors_enhanced;

    // 从UI读取并保存
    settings.chunk_size = parseInt($('#vectors_enhanced_chunk_size').val()) || 1000;
    settings.overlap_percent = parseInt($('#vectors_enhanced_overlap_percent').val()) || 10;

    saveSettingsDebounced();

    console.log('[VectorizationSettings] 保存配置:', {
        chunk_size: settings.chunk_size,
        overlap_percent: settings.overlap_percent
    });
}

// 3. 确保向量化处理器使用正确的配置
function getVectorizationProcessorSettings(contentSettings, globalSettings) {
    return {
        source: contentSettings.chat?.source || globalSettings.source,
        chunk_size: contentSettings.chat?.chunk_size || globalSettings.chunk_size || 1000,
        overlap_percent: contentSettings.chat?.overlap_percent || globalSettings.overlap_percent || 10,
        force_chunk_delimiter: contentSettings.chat?.force_chunk_delimiter || globalSettings.force_chunk_delimiter || false
    };
}

// 导出函数
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        loadVectorizationSettings,
        saveVectorizationSettings,
        getVectorizationProcessorSettings
    };
}