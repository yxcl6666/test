// 初始化向量化设置
export function initVectorizationSettings() {
    console.log('[VectorizationSettings] 初始化向量化设置...');

    // 确保配置对象存在
    if (!extension_settings.vectors_enhanced) {
        extension_settings.vectors_enhanced = {};
    }

    const settings = extension_settings.vectors_enhanced;

    // 从UI加载配置（如果存在）
    const chunkSizeEl = document.getElementById('vectors_enhanced_chunk_size');
    const overlapEl = document.getElementById('vectors_enhanced_overlap_percent');

    // 设置默认值
    if (!settings.chunk_size) {
        settings.chunk_size = chunkSizeEl ? parseInt(chunkSizeEl.value) || 1000 : 1000;
    }

    if (!settings.overlap_percent) {
        settings.overlap_percent = overlapEl ? parseInt(overlapEl.value) || 10 : 10;
    }

    // 确保UI显示正确的值
    if (chunkSizeEl) {
        chunkSizeEl.value = settings.chunk_size;
    }
    if (overlapEl) {
        overlapEl.value = settings.overlap_percent;
    }

    // 添加保存事件监听
    if (chunkSizeEl) {
        chunkSizeEl.addEventListener('change', () => {
            settings.chunk_size = parseInt(chunkSizeEl.value) || 1000;
            saveSettingsDebounced();
            console.log('[VectorizationSettings] 更新 chunk_size:', settings.chunk_size);
        });
    }

    if (overlapEl) {
        overlapEl.addEventListener('change', () => {
            settings.overlap_percent = parseInt(overlapEl.value) || 10;
            saveSettingsDebounced();
            console.log('[VectorizationSettings] 更新 overlap_percent:', settings.overlap_percent);
        });
    }

    console.log('[VectorizationSettings] 初始化完成:', {
        chunk_size: settings.chunk_size,
        overlap_percent: settings.overlap_percent
    });

    return settings;
}

// 导出函数供其他模块使用
window.initVectorizationSettings = initVectorizationSettings;