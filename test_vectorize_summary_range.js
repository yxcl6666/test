// 测试向量化范围和总结范围的一致性

// 模拟场景
const scenarios = [
    {
        name: "场景1：刚好一个间隔",
        currentFloor: 25,  // 第25层（索引24）
        keepCount: 5,     // 保留5层
        interval: 5,      // 间隔5层
        lastSummarized: 15, // 上次总结到了第14层，下次从第15层开始
    },
    {
        name: "场景2：距离不足以触发",
        currentFloor: 23,  // 第23层（索引22）
        keepCount: 5,     // 保留5层
        interval: 5,      // 间隔5层
        lastSummarized: 15, // 上次总结到了第14层，下次从第15层开始
    },
    {
        name: "场景3：多个间隔",
        currentFloor: 35,  // 第35层（索引34）
        keepCount: 5,     // 保留5层
        interval: 5,      // 间隔5层
        lastSummarized: 15, // 上次总结到了第14层，下次从第15层开始
    }
];

console.log("测试向量化范围和总结范围的一致性：\n");

scenarios.forEach((scenario, index) => {
    console.log(`=== ${scenario.name} ===`);
    console.log(`当前楼层: ${scenario.currentFloor} (索引${scenario.currentFloor - 1})`);
    console.log(`保留层数: ${scenario.keepCount}`);
    console.log(`间隔: ${scenario.interval}`);
    console.log(`上次总结到: 第${scenario.lastSummarized - 1}层`);
    console.log(`下次开始: 第${scenario.lastSummarized}层\n`);

    // 计算过程
    const safeLimit = scenario.currentFloor - scenario.keepCount;
    const startIndex = scenario.lastSummarized - 1;  // 转换为索引
    const endIndex = Math.min(safeLimit, startIndex + scenario.interval - 1);

    console.log("计算过程:");
    console.log(`safeLimit = ${scenario.currentFloor} - ${scenario.keepCount} = ${safeLimit}`);
    console.log(`startIndex = ${scenario.lastSummarized} - 1 = ${startIndex}`);
    console.log(`endIndex = Math.min(${safeLimit}, ${startIndex} + ${scenario.interval} - 1) = ${endIndex}\n`);

    // 结果
    console.log("结果:");
    console.log(`向量化范围: 索引 ${startIndex} 到 ${endIndex}`);
    console.log(`总结范围: 索引 ${startIndex} 到 ${endIndex}`);
    console.log(`显示楼层: #${startIndex + 1} 至 #${endIndex + 1}`);
    console.log(`是否包含保留层: ${endIndex >= safeLimit ? '是（错误！）' : '否（正确）'}\n`);

    console.log("---");
});

// 测试基于世界书的情况
console.log("\n=== 测试基于世界书进度触发 ===");
const worldBookScenario = {
    currentFloor: 25,
    keepCount: 5,
    interval: 5,
    lastSummarizedFromWorldBook: 15  // 从世界书获取的值
};

const safeLimitWB = worldBookScenario.currentFloor - worldBookScenario.keepCount;
const startIndexWB = worldBookScenario.lastSummarizedFromWorldBook - 1;
const endIndexWB = Math.min(safeLimitWB, startIndexWB + worldBookScenario.interval - 1);

console.log(`基于世界书进度:`);
console.log(`世界书记录 lastSummarized = ${worldBookScenario.lastSummarizedFromWorldBook}`);
console.log(`将总结第 ${startIndexWB + 1} 至 ${endIndexWB + 1} 层`);
console.log(`安全限制: 第 ${safeLimitWB} 层（保留 ${worldBookScenario.keepCount} 层）`);
console.log(`总结范围正确吗: ${endIndexWB < safeLimitWB ? '是' : '否'}`);