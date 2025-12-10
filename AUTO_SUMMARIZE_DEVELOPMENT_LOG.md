# 自动总结功能开发日志

## 文档目的
记录自动总结功能的开发历程、关键决策、已知问题和注意事项，便于后续维护和问题排查。

## 最后更新时间
2024-12-11 (更新：添加智能追赶按钮的自动向量化支持)

## 核心功能概述
自动总结功能是 Vectors Enhanced 扩展的核心特性之一，能够：
- 根据设定的间隔自动总结聊天内容
- 支持基于世界书进度的智能追赶
- 自动向量化总结的内容
- 自动隐藏已总结的楼层
- 创建世界书记录保存总结内容

## 楼层编号系统（重要！）

### 基本规则
```
lastSummarizedFloor: 楼层号（1-based）
- 表示"下次开始总结的楼层"
- 例如：如果值为6，表示上次总结到了第5层，下次从第6层开始
- 存储在 chat_metadata 中

startIndex/endIndex: 数组索引（0-based）
- 用于访问 chat 数组
- 例如：要总结第6-10层，startIndex=5, endIndex=9
- 转换公式：startIndex = lastSummarized - 1

显示给用户：统一使用 1-based（楼层号）
- 弹窗显示："总结 #6 至 #10"
- 世界书记录："楼层 #6-10"
```

### 关键转换公式
```javascript
// 楼层号转索引
let startIndex = lastSummarized - 1;  // lastSummarized是1-based，结果0-based

// 索引转楼层号
let displayFloor = index + 1;  // index是0-based，结果1-based

// 更新lastSummarized（总结完成后）
lastSummarized = endIndex + 2;
// endIndex是0-based，endIndex+1是结束楼层号（1-based）
// 再+1是下次开始的楼层号（1-based）
```

## 主要修复记录

### 1. 楼层索引转换问题（最关键）
**问题**：混用1-based和0-based导致总结范围偏移
**修复**：
- 统一了转换逻辑
- 添加了全局注释说明
- 确保lastSummarized始终是楼层号

### 2. 智能追赶模式优化
**问题**：只能执行一次，楼层范围显示错误
**修复**：
- 修复循环条件：`lastSummarized + interval - 1 <= safeLimitFloor`
- 修复楼层更新：`lastSummarized = endIndex + 2`
- 添加批次衔接逻辑
- 修正完成提示信息

### 3. 内容选择设置遵循
**问题**：硬编码只总结AI消息
**修复**：
- 复用getMessages和messageOptions逻辑
- 根据用户勾选决定总结哪些消息
- 支持用户消息、AI消息、隐藏消息的灵活组合

### 4. 弹窗消息准确性
**问题**：显示范围与实际总结不符
**修复**：
- 统一使用startIndex + 1和endIndex + 1
- 添加endIndex变化检测
- 增强调试日志

### 5. 世界书绑定数值
**问题**：记录的楼层范围不正确
**修复**：
- 确保传递正确的楼层号
- 使用startIndex + 1和endIndex + 1

### 6. 手动智能追赶按钮功能（新增）
**功能**：添加手动触发智能追赶的按钮
**实现**：
- 在UI中添加"智能追赶"按钮
- 实现 `handleSmartCatchUp` 方法
- 支持批量处理多个批次
- 提供确认对话框和进度反馈

### 7. 自动向量化支持完善（更新）
**问题**：智能追赶模式和手动追赶不支持自动向量化
**修复**：
- 在 `performAutoSummarizeDirect` 中添加自动向量化逻辑
- 确保与正常模式的向量化行为一致
- 区分不同模式的任务名称（智能追赶向量化 vs 自动向量化）

## 当前实现细节

### 核心方法
1. **getLastSummarizedFloor(forceSync = false)**
   - 获取上次总结到的楼层
   - 支持从世界书同步进度
   - 初次使用返回0

2. **checkAutoSummarize()**
   - 检查是否触发自动总结
   - 判断使用追赶模式还是正常模式

3. **performAutoSummarize()**
   - 执行自动总结的主方法
   - 处理追赶和正常两种模式

4. **continueSmartCatchUp()**
   - 智能追赶的核心实现
   - 支持多批次处理

5. **performAutoSummarizeInRange()**
   - 处理指定范围的总结
   - 用于追赶模式

6. **performAutoSummarizeDirect()**
   - 直接执行总结（简化版）
   - 避免循环调用

### 关键配置项
```javascript
// UI元素选择器
$('#memory_auto_summarize')           // 主开关
$('#memory_auto_summarize_interval')   // 总结间隔
$('#memory_auto_summarize_count')      // 保留层数
$('#memory_auto_sync_world_info')      // 世界书进度同步
$('#memory_hide_floors_after_summary') // 总结后隐藏楼层
$('#memory_auto_create_world_book')    // 自动创建世界书
```

## 已知问题和注意事项

### 1. currentFloor的时机问题
**现象**：如果在计算endIndex后又有新消息，可能导致显示错误
**解决方案**：在函数开始就保存currentFloor的值

### 2. 保留层数的处理
**注意**：保留的层数不会被总结，endIndex计算要考虑keepCount
```javascript
let endIndex = Math.min(currentFloor - keepCount, startIndex + interval - 1);
```

### 3. 世界书绑定逻辑
**注意**：
- chat_metadata[METADATA_KEY] 存储绑定的世界书名称
- 世界书进度解析需要处理"楼层 #X-Y"格式
- 自动绑定功能在ensureWorldBookBound()中

### 4. 调试技巧
查看以下日志有助于问题排查：
- `[MemoryUI] 范围计算详情` - 显示所有计算过程
- `[MemoryUI] 追赶批次` - 显示追赶模式详情
- `[MemoryUI] 自动总结完成，范围记录` - 显示最终保存的范围
- `[MemoryUI] getLastSummarizedFloor` - 显示楼层获取过程

## 测试用例

### 基础测试
1. **初次使用**（无世界书）
   - 验证能从第0层开始总结
   - 验证first message不应用标签提取

2. **正常模式**
   - 设置间隔5层，保留2层
   - 在第26层验证总结20-24层
   - 验证弹窗显示正确

3. **追赶模式**
   - 模拟落后3个间隔
   - 验证分3批次追赶
   - 验证批次衔接正确
   - 验证完成后切换正常模式

4. **世界书同步**
   - 创建包含楼层信息的世界书
   - 验证能正确解析进度
   - 验证重置功能

5. **内容选择**
   - 只勾选"用户消息"
   - 只勾选"AI消息"
   - 同时勾选用户和AI消息
   - 勾选"包含隐藏消息"

## 常见错误排查

### 1. 总结范围偏移
**症状**：显示的楼层范围与实际不符
**检查**：
- 确认startIndex和endIndex的计算
- 查看控制台的"范围计算详情"日志
- 确认lastSummarized的值是否正确

### 2. 追赶模式不工作
**症状**：只总结一次，不继续追赶
**检查**：
- 查看循环条件是否满足
- 确认safeLimit的计算
- 查看批次更新日志

### 3. 世界书记录错误
**症状**：世界书条目名称楼层范围不对
**检查**：
- 确认传递给createWorldBook的参数
- 确认是使用startIndex+1还是endIndex+1

### 4. 隐藏楼层失败
**症状**：总结后楼层没有被隐藏
**检查**：
- 确认hideFloorsIfEnabled被调用
- 确认保存聊天记录的函数可用

## 性能优化建议

1. **批量处理**：追赶模式已实现批量处理，默认最多10个批次
2. **延迟控制**：每个批次间有1秒延迟，避免API限制
3. **缓存优化**：getMessages已做优化，避免重复计算

## 未来改进方向

1. **UI增强**：添加可视化进度条显示追赶进度
2. **配置持久化**：保存用户的总结设置偏好
3. **智能间隔**：根据聊天密度动态调整总结间隔
4. **总结质量评估**：添加总结内容质量评分机制

## 相关文件位置

```
主要文件：
- src/ui/components/MemoryUI.js         - UI组件和核心逻辑
- src/core/memory/MemoryService.js    - 服务层，处理世界书创建
- src/utils/chatUtils.js               - 聊天工具，包含getMessages
- src/utils/tagExtractor.js            - 标签提取工具

配置文件：
- settings-modular.html               - UI设置界面

测试工具：
- debug/                             - 调试工具目录
```

## 开发最佳实践

1. **修改前先看注释**：文件开头有重要的楼层系统说明
2. **测试要全面**：每次修改都要测试各种模式
3. **日志要详细**：关键计算都有日志输出，便于排查
4. **保持一致性**：新的功能要与现有逻辑保持一致的转换规则
5. **注意边界情况**：如初次使用、无世界书、消息不足等

## 联系方式
如遇问题，请查看控制台日志，特别是带有`[MemoryUI]`前缀的日志。