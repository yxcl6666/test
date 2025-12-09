# GEMINI.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是 Vectors Enhanced - 一个 SillyTavern 的向量化扩展插件，提供语义搜索、智能记忆管理和内容处理功能。

## 开发环境设置

### 必要条件
- SillyTavern 最新版本
- Node.js 14+
- 现代浏览器（Chrome/Firefox/Edge）

### 安装步骤
1. 将扩展文件夹复制到 SillyTavern 的扩展目录：
   ```
   SillyTavern/public/scripts/extensions/third-party/vectors-enhanced/
   ```

2. 在 SillyTavern 中启用扩展（扩展设置）

## 常用开发命令

由于这是一个前端扩展插件，没有传统的 npm scripts。主要开发流程是：

### 调试技巧
1. 使用浏览器开发者工具查看控制台日志
2. 检查 SillyTavern 的扩展面板
3. 查看 `src/utils/Logger.js` 了解日志系统

### 测试功能
1. 在 SillyTavern 中加载扩展
2. 在聊天界面测试各项功能
3. 使用 debug/ 目录下的调试工具：
   ```javascript
   // 在浏览器控制台运行
   // 使用内置的调试功能
   ```

## 技术架构

### 分层架构
```
应用层 (Application Layer)
├── index.js - 主入口文件
└── UI 交互逻辑

核心层 (Core Layer)
├── entities/ - 实体模型 (Content, Vector, Task)
├── extractors/ - 内容提取器系统
├── pipeline/ - 处理管道和中间件
├── memory/ - 记忆管理系统
├── external-tasks/ - 外挂任务系统
└── export-import/ - 向量导入导出

UI层 (UI Layer)
├── components/ - 15+ 独立组件
├── StateManager.js - 状态管理
├── EventManager.js - 事件管理
└── settingsManager.js - 设置管理

基础设施层 (Infrastructure Layer)
├── events/ - 事件总线
├── storage/ - 存储适配器
├── api/ - 向量化引擎适配器
└── ConfigManager.js - 配置管理
```

### 关键设计模式
- **适配器模式**: 向量化引擎适配（6种引擎）
- **策略模式**: 内容提取器、处理器
- **中间件模式**: 管道处理
- **观察者模式**: 事件系统
- **工厂模式**: 处理器创建

## 核心功能模块

### 1. 向量化系统
- 支持6种向量化引擎：Transformers.js, Ollama, vLLM, WebLLM, OpenAI, Cohere
- 批量处理和去重机制
- 两阶段架构：数据准备与向量化分离

### 2. 提取器系统 (src/core/extractors/)
- IContentExtractor: 基础接口
- ChatExtractor: 聊天内容提取，支持标签规则
- FileExtractor: 文件内容提取
- WorldInfoExtractor: 世界信息提取

### 3. 处理管道 (src/core/pipeline/)
- TextPipeline: 管道管理器
- PipelineEventBus: 事件总线
- ProcessingContext: 处理上下文
- 支持中间件：日志、转换、验证

### 4. UI组件系统
每个组件都是独立的类，负责特定的UI功能：
- ActionButtons: 操作按钮
- TaskList: 任务列表
- MemoryUI: 记忆管理
- SettingsPanel: 设置面板
- ProgressManager: 进度管理

## 开发指南

### 添加新的向量化引擎
1. 在 `src/infrastructure/api/VectorizationAdapter.js` 中添加引擎配置
2. 实现适配器接口
3. 在 UI 中添加相应的设置选项

### 添加新的内容提取器
1. 实现 `IContentExtractor` 接口
2. 在 `ProcessorFactory` 中注册
3. 更新 UI 组件以支持新提取器

### 添加新的管道中间件
1. 实现 `IMiddleware` 接口
2. 在 `MiddlewareManager` 中注册
3. 配置中间件顺序

### 添加新的UI组件
1. 在 `src/ui/components/` 创建新组件
2. 在 `index.js` 中初始化
3. 使用 EventManager 管理事件

## 重要文件说明

### 主入口文件
- `index.js`: 扩展主入口，包含所有初始化逻辑和SillyTavern集成

### 核心实体
- `src/core/entities/Content.js`: 内容实体
- `src/core/entities/Vector.js`: 向量实体
- `src/core/entities/Task.js`: 任务实体

### 工具类
- `src/utils/tagExtractor.js`: 标签提取工具
- `src/utils/chatUtils.js`: 聊天处理工具
- `src/utils/Logger.js`: 日志系统

### 调试工具
- `debug/`: 调试工具集
  - `debugger.js`: 主调试器
  - `analyzers/`: 数据分析工具
  - `tools/`: 实用工具

## 扩展开发要点

### 事件系统
使用 `eventBus` 进行模块间通信：
```javascript
import { eventBus } from './src/infrastructure/events/eventBus.instance.js';

// 发布事件
eventBus.emit('vectors:taskCreated', taskData);

// 订阅事件
eventBus.on('vectors:taskCreated', (taskData) => {
    // 处理事件
});
```

### 状态管理
使用 `StateManager` 管理 UI 状态：
```javascript
import { stateManager } from './src/ui/StateManager.js';

// 获取状态
const state = stateManager.getState();

// 更新状态
stateManager.setState('key', value);
```

### 配置管理
使用 `ConfigManager` 管理配置：
```javascript
import { configManager } from './src/infrastructure/ConfigManager.js';

// 获取配置
const value = configManager.get('path.to.key');

// 设置配置
configManager.set('path.to.key', value);
```

## 注意事项

1. **SillyTavern 集成**: 所有功能需要通过 SillyTavern 的 API 进行集成
2. **性能考虑**: 使用批量处理和缓存机制优化性能
3. **错误处理**: 所有异步操作都需要适当的错误处理
4. **日志记录**: 使用 Logger.js 记录重要操作
5. **UI 响应性**: 使用 debounce 处理高频操作
6. **向后兼容**: 保持与旧格式的兼容性

## 扩展文档

- 详细使用教程：`标签提取示例.md`
- 各模块的 README 文件包含更详细的信息