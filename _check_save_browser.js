// 在浏览器控制台中运行此代码
(function() {
    const worldSeed = '1161534808';
    const charName = '流烬沙25';
    
    console.log('=== 存档诊断工具 ===');
    
    // 查找所有可能的世界档键名
    const worldKeys = Object.keys(localStorage).filter(k => k.includes('world_' + worldSeed));
    console.log(' 世界档键名:', worldKeys);
    
    // 查找所有可能的角色档键名
    const charKeys = Object.keys(localStorage).filter(k => k.includes('character_' + charName));
    console.log(' 角色档键名:', charKeys);
    
    // 检查世界档内容
    if (worldKeys.length > 0) {
        try {
            const data = JSON.parse(localStorage.getItem(worldKeys[0]));
            console.log(' 世界档内容:', {
                characterName: data.characterName,
                day: data.day,
                playT: data.playT,
                hasZombies: !!data.zombies
            });
        } catch(e) {
            console.log('❌ 世界档解析失败:', e.message);
        }
    }
    
    // 检查角色档内容
    if (charKeys.length > 0) {
        try {
            const data = JSON.parse(localStorage.getItem(charKeys[0]));
            console.log(' 角色档内容:', {
                name: data.name,
                level: data.level,
                hasData: !!data,
                keys: Object.keys(data).slice(0, 10)
            });
        } catch(e) {
            console.log('❌ 角色档解析失败:', e.message);
        }
    }
    
    // 输出诊断结果
    console.log('\n=== 诊断结果 ===');
    console.log('世界档存在:', worldKeys.length > 0);
    console.log('角色档存在:', charKeys.length > 0);
    if (worldKeys.length > 0) {
        const worldData = JSON.parse(localStorage.getItem(worldKeys[0]));
        console.log('世界档声明的角色:', worldData?.characterName);
        console.log('实际角色档数量:', charKeys.length);
        
        if (worldData?.characterName && charKeys.length === 0) {
            console.log('⚠️ 问题：世界档声明绑定了角色，但角色档不存在！');
            console.log('这就是为什么存档被锁定但无法开始游戏的原因。');
        }
    }
})();
