// 临时脚本：检查存档状态
// 请在浏览器控制台中运行以下代码，然后粘贴结果到这里

const checkCode = `
// 在浏览器控制台中运行
(function() {
    const worldSeed = '1161534808';
    const charName = '流烬沙25';
    
    // 查找所有可能的世界档键名
    const worldKeys = Object.keys(localStorage).filter(k => k.includes('world_' + worldSeed));
    console.log('世界档键名:', worldKeys);
    
    // 查找所有可能的角色档键名
    const charKeys = Object.keys(localStorage).filter(k => k.includes('character_' + charName));
    console.log('角色档键名:', charKeys);
    
    // 检查世界档内容
    worldKeys.forEach(key => {
        try {
            const data = JSON.parse(localStorage.getItem(key));
            console.log('世界档', key, ':', {
                characterName: data.characterName,
                day: data.day,
                playT: data.playT
            });
        } catch(e) {
            console.log('世界档', key, '解析失败:', e.message);
        }
    });
    
    // 检查角色档内容
    charKeys.forEach(key => {
        try {
            const data = JSON.parse(localStorage.getItem(key));
            console.log('角色档', key, ':', {
                name: data.name,
                level: data.level,
                hasData: !!data
            });
        } catch(e) {
            console.log('角色档', key, '解析失败:', e.message);
        }
    });
    
    // 输出完整的检查结果
    console.log('\\n=== 检查结果 ===');
    console.log('世界档数量:', worldKeys.length);
    console.log('角色档数量:', charKeys.length);
    console.log('世界档有characterName:', worldKeys.length > 0 && JSON.parse(localStorage.getItem(worldKeys[0]))?.characterName);
    console.log('角色档存在:', charKeys.length > 0);
})();
`;

console.log('请在浏览器控制台中运行以下代码：\n');
console.log(checkCode);
console.log('\n然后将输出结果复制给我。');
