// scripts/main.js
const shallowSea = Attribute.add("shallow-sea");
const deepSea = Attribute.add("deep-sea");

// --- Weapon parts load fix ---
// Weapon.load() in 158.1 does NOT call part.load() on its parts array,
// so weapon RegionParts never get their regions populated and don't render.
(function(){
    var MOD_ID = "ud-mod";
    var attempts = 0;

    function fixWeaponParts(){
        var unitName = MOD_ID + "-treadmill-beta";
        var unit = null;

        try { unit = Vars.content.getByName("UnitType", unitName); } catch(e) {}
        if (!unit) try { unit = Vars.content.getByID("UnitType", unitName); } catch(e) {}
        if (!unit) try { unit = Vars.content.unit(unitName); } catch(e) {}
        if (!unit) try { unit = Vars.content.find(unitName); } catch(e) {}

        if (!unit){
            var c = Vars.content;
            for (var k in c){
                try {
                    var val = c[k];
                    if (val && val.size !== undefined && val.get !== undefined){
                        for (var j = 0; j < val.size; j++){
                            var item = val.get(j);
                            if (item && item.name && item.name.indexOf("treadmill") >= 0){
                                unit = item;
                                break;
                            }
                        }
                    }
                } catch(e) {}
                if (unit) break;
            }
        }

        if (!unit || !unit.weapons || unit.weapons.size === 0) return false;

        for (var w = 0; w < unit.weapons.size; w++){
            var weapon = unit.weapons.get(w);
            if (!weapon.parts) continue;
            for (var p = 0; p < weapon.parts.size; p++){
                var part = weapon.parts.get(p);
                var regionsLen = part.regions ? (part.regions.length !== undefined ? part.regions.length : part.regions.size) : 0;
                if (regionsLen > 0) continue;
                if (part.name && part.name.indexOf(MOD_ID) !== 0){
                    part.name = MOD_ID + "-" + part.name;
                }
                part.load(part.name || "");
            }
        }
        return true;
    }

    function retry(){
        attempts++;
        try {
            if (!fixWeaponParts() && attempts < 30){
                Core.app.post(retry);
            }
        } catch(e) {
            if (attempts < 30) Core.app.post(retry);
        }
    }
    retry();
})();

// RegionPart 旋转装饰使用说明（纯 JSON，无需 JS 兜底）：
//   "type": "RegionPart",
//   "name": "<mod>-<unit>-<suffix>",   // 完整 atlas 贴图名
//   "outline": false,                    // 关闭描边避免紫框
//   "progress": "time",                  // 用 Time.time 驱动自转
//   "clampProgress": false,              // 必须 false，否则 Time.time 被截到 0~1 转不动
//   "moveRot": 1.0,                      // 度/刻，60刻≈1秒 → 约 60°/秒
//   "x": 0, "y": 0

// =====================================================================
// --- 研究成本自定义覆盖（可复用配置表）---
// 通过直接修改 TechNode.requirements，实现"建造消耗 requirements"
// 与 "研究消耗 researchRequirements" 完全解耦。
// 新增建筑只需修改下面的 RESEARCH_COST_OVERRIDES 配置表即可。
// =====================================================================

// ======== 在这里配置各建筑的研究成本 ========
// 键：内容 name（可以不带 ud-mod- 前缀，系统会自动补）
// 值：{ "资源名": 数量, ... }（资源名同样可不带前缀）
var RESEARCH_COST_OVERRIDES = {
    "dri-harvester": {
        "heavy-stone": 30,
        "quartz-sand": 10
    },
    "dri-hydraulic": {
        "heavy-stone": 20
    },
    "dri-electrical": {
        "heavy-stone": 3000,
        "pressure-resistant-glass": 2000,
        "chip": 2000
    },
    "dri-precise": {
        "ceramic-steel": 5000,
        "pressure-resistant-glass": 3000,
        "advanced-chip": 1500
    },
    "under-water-small-core": {
        "heavy-stone": 5,
        "quartz-sand": 5,
    },
    "under-water-middle-core": {
        "heavy-stone": 10000,
        "quartz-sand": 10000,
        "chip": 7500,
        "pressure-resistant-glass": 7500
    },
    "under-water-big-core": {
        "ceramic-steel": 10000,
        "desiccant": 8000,
        "advanced-chip": 5000,
        "pressure-resistant-glass": 10000,
    },
    "duct-item-basic": {
        "heavy-stone": 20,
        "quartz-sand": 10
    },
    "duct-item-advanced": {
        "tuberculosis": 6000,
        "pressure-resistant-glass": 2500
    }
};

(function(){
    var MOD_ID = "ud-mod";
    var TAG = "[ud-mod-research]";
    var MAX_RETRIES = 60;
    var attempts = 0;
    var appliedOnce = false;

    function log(msg){
        try { print(TAG + " " + msg); } catch(e) {}
    }

    // 在 Vars.content 中按 name 查找任意内容（block/item/unit/liquid/sector）
    // 支持裸名（自动尝试补 MOD_ID 前缀）
    function findContentByName(rawName){
        var candidates = [rawName];
        if(rawName.indexOf(MOD_ID + "-") !== 0){
            candidates.push(MOD_ID + "-" + rawName);
        }
        for(var ci = 0; ci < candidates.length; ci++){
            var name = candidates[ci];
            var c = null;
            // 路径 1：Content 专用 getter（最可靠）
            try { c = Vars.content.block(name); } catch(e) {}
            if(c && c.name === name) return c;
            try { c = Vars.content.unit(name); } catch(e) {}
            if(c && c.name === name) return c;
            try { c = Vars.content.liquid(name); } catch(e) {}
            if(c && c.name === name) return c;
            try { c = Vars.content.sector(name); } catch(e) {}
            if(c && c.name === name) return c;

            // 路径 2：getByName
            var types = ["Block", "UnitType", "Liquid", "SectorPreset"];
            for(var ti = 0; ti < types.length; ti++){
                try { c = Vars.content.getByName(types[ti], name); } catch(e) { c = null; }
                if(c) return c;
            }

            // 路径 3：直接遍历 Seq（不依赖 for...in）
            try {
                var bs = Vars.content.blocks();
                if(bs && bs.size !== undefined){
                    for(var j = 0; j < bs.size; j++){
                        var b = bs.get(j);
                        if(b && b.name === name) return b;
                    }
                }
            } catch(e) {}
            try {
                var us = Vars.content.units();
                if(us && us.size !== undefined){
                    for(var j = 0; j < us.size; j++){
                        var u = us.get(j);
                        if(u && u.name === name) return u;
                    }
                }
            } catch(e) {}
            try {
                var ls = Vars.content.liquids();
                if(ls && ls.size !== undefined){
                    for(var j = 0; j < ls.size; j++){
                        var l = ls.get(j);
                        if(l && l.name === name) return l;
                    }
                }
            } catch(e) {}
            try {
                var ss = Vars.content.sectors();
                if(ss && ss.size !== undefined){
                    for(var j = 0; j < ss.size; j++){
                        var s = ss.get(j);
                        if(s && s.name === name) return s;
                    }
                }
            } catch(e) {}
        }
        log("findContent '" + rawName + "' → NOT FOUND");
        return null;
    }

    // 按物品名查找 Item（支持裸名）
    function findItem(rawName){
        var candidates = [rawName];
        if(rawName.indexOf(MOD_ID + "-") !== 0){
            candidates.push(MOD_ID + "-" + rawName);
        }
        for(var i = 0; i < candidates.length; i++){
            var name = candidates[i];
            var item = null;
            // 路径 1：Vars.content.item(name)
            try { item = Vars.content.item(name); } catch(e) {}
            if(item) return item;
            // 路径 2：getByName("Item", name)
            try { item = Vars.content.getByName("Item", name); } catch(e) {}
            if(item) return item;
            // 路径 3：直接扫 items() Seq（不依赖 for...in）
            try {
                var is_ = Vars.content.items();
                if(is_ && is_.size !== undefined){
                    for(var j = 0; j < is_.size; j++){
                        var it = is_.get(j);
                        if(it && it.name === name) return it;
                    }
                }
            } catch(e) {}
        }
        log("findItem '" + rawName + "' → NOT FOUND");
        return null;
    }

    // 构造 ItemStack
    function makeStack(item, amount){
        var stk = null;
        // 路径 1：new ItemStack(item, amount)
        try {
            stk = new ItemStack(item, amount);
            if(stk) return stk;
        } catch(e1) {}

        // 路径 2：ItemStack.with(item, amount)
        try {
            if(typeof ItemStack !== "undefined" && ItemStack.with){
                var result = ItemStack.with(item, amount);
                if(result){
                    if(result.length !== undefined && result.length > 0) return result[0];
                    if(result.size !== undefined && result.size > 0) return result.get(0);
                    // result 本身可能就是单个 ItemStack
                    if(result.item && result.amount !== undefined) return result;
                }
            }
        } catch(e2) {}

        // 路径 3：从已有 content.techNode.requirements 克隆并改字段
        try {
            var all = Vars.content;
            for(var k in all){
                try {
                    var seq = all[k];
                    if(seq && seq.size !== undefined && seq.get !== undefined){
                        for(var j = 0; j < seq.size; j++){
                            var it = seq.get(j);
                            if(it && it.techNode && it.techNode.requirements){
                                var reqs = it.techNode.requirements;
                                var src = null;
                                if(reqs.length !== undefined && reqs.length > 0) src = reqs[0];
                                else if(reqs.size !== undefined && reqs.size > 0) src = reqs.get(0);
                                if(src && src.item !== undefined && src.amount !== undefined){
                                    // 浅拷贝 + 改字段（JS Rhino 中 Java 对象属性可直接赋值）
                                    var clone = {};
                                    for(var pk in src){ try { clone[pk] = src[pk]; } catch(ex){} }
                                    try { clone.item = item; clone.amount = amount; } catch(ex){}
                                    if(clone.item && clone.amount !== undefined) return clone;
                                }
                            }
                        }
                    }
                } catch(e) {}
            }
        } catch(e3) {}

        log("makeStack FAILED for item=" + (item ? item.name : "null") + " amount=" + amount);
        return null;
    }

    function applyOverrides(){
        // 检查 TechTree 是否已构建：第一个配置项已挂上 techNode
        var firstKey = null;
        for(var fk in RESEARCH_COST_OVERRIDES){
            if(RESEARCH_COST_OVERRIDES.hasOwnProperty(fk)){ firstKey = fk; break; }
        }
        if(!firstKey) return true;

        var firstContent = findContentByName(firstKey);
        if(!firstContent) return false;
        if(!firstContent.techNode) return false;

        var processed = 0;
        var total = 0;
        for(var key in RESEARCH_COST_OVERRIDES){
            if(!RESEARCH_COST_OVERRIDES.hasOwnProperty(key)) continue;
            total++;
            try {
                var content = findContentByName(key);
                if(!content){
                    log("SKIP " + key + " → content not found");
                    continue;
                }
                if(!content.techNode){
                    log("SKIP " + key + " → no techNode");
                    continue;
                }

                var costSpec = RESEARCH_COST_OVERRIDES[key];
                var stacks = [];
                for(var itemKey in costSpec){
                    if(!costSpec.hasOwnProperty(itemKey)) continue;
                    var wantAmount = costSpec[itemKey];
                    var itemObj = findItem(itemKey);
                    if(!itemObj){
                        log("missing item '" + itemKey + "' for " + key);
                        continue;
                    }
                    var stk = makeStack(itemObj, wantAmount);
                    if(stk) stacks.push(stk);
                }

                if(stacks.length === 0){
                    log("SKIP " + key + " → no stacks built");
                    continue;
                }

                // 构造 finishedRequirements（全部初始化为 0）
                var finished = [];
                for(var si = 0; si < stacks.length; si++){
                    var fs = makeStack(stacks[si].item, 0);
                    finished.push(fs || stacks[si]);
                }

                // 调用 techNode.setupRequirements() 而非直接赋值：
                // TechTree.java 中 setupRequirements 同时处理 requirements + finishedRequirements + settings 读取。
                var assigned = false;
                try {
                    if(typeof content.techNode.setupRequirements === "function"){
                        content.techNode.setupRequirements(stacks);
                        assigned = true;
                    }
                } catch(eSetup) { log("ERROR " + key + " setupRequirements: " + eSetup); }

                if(!assigned){
                    // 兜底：直接赋值
                    try {
                        content.techNode.requirements = stacks;
                        content.techNode.finishedRequirements = finished;
                        assigned = true;
                    } catch(eAssign) { log("ERROR " + key + " direct assign: " + eAssign); }
                }

                if(assigned) processed++;
            } catch(err) {
                log("ERROR processing " + key + ": " + err);
            }
        }

        log("SUMMARY processed=" + processed + "/" + total);
        appliedOnce = (processed === total);
        return appliedOnce;
    }

    function retry(){
        attempts++;
        try {
            var done = applyOverrides();
            if(!done && attempts < MAX_RETRIES){
                try {
                    Timer.schedule(function(){ retry(); }, 0.05 + Math.min(attempts, 30) * 0.02);
                } catch(eTimer) {
                    try { Core.app.post(retry); } catch(ePost) {}
                }
            } else if(!done && attempts === MAX_RETRIES){
                log("GIVE UP after " + MAX_RETRIES + " attempts — requirements NOT applied");
            } else if(done){
                log("ALL overrides applied successfully at attempt #" + attempts);
            }
        } catch(e) {
            log("retry() caught exception: " + e);
            if(attempts < MAX_RETRIES){
                try { Core.app.post(retry); } catch(e2) {}
            }
        }
    }

    // 启动：分两个时机各跑一次，避免 TechTree 在 ClientLoadEvent 时重建
    // 时机 1：Core.app.post（尽早尝试）
    try { Core.app.post(retry); } catch(e) {}

    // 时机 2：ClientLoadEvent 后（此时 UI/TechTree 对话框已经初始化）
    try {
        Events.on(EventType.ClientLoadEvent, function(){
            attempts = 0;
            appliedOnce = false;
            try { Core.app.post(retry); } catch(e) {}
        });
    } catch(eEvent) {
        // 兜底：额外再排一个 2 秒后的单独重试
        try { Timer.schedule(function(){ attempts = 0; appliedOnce = false; retry(); }, 2.0); }
        catch(eFallback) {}
    }
})();

// ============= 拉莱耶星球常驻天气注入 =============
// 背景：158.1 的 Planet/Sector 类没有 weather 字段（planet hjson 中的 weather 数组会被解析器忽略，
// 日志报 Unknown field 'weather' for class 'Planet'）。158.1 中天气清单挂在 state.rules.weather
// （Rules 类字段，Logic.updateWeather() 每帧消费：always=true 时以无限时长 spawn）。
// 因此用 JS 周期检查：进入拉莱耶战役区块且 rules.weather 未包含目标天气时，注入 WeatherEntry。
(function(){
    var T_MOD_ID = "ud-mod";
    var T_LOG = "[ud-mod-weather]";
    var PLANET_KEY = "rlyeh-planet";
    var WEATHER_KEY = "wea-under-water";

    function wlog(msg){
        try { print(T_LOG + " " + msg); } catch(e) {}
    }

    // 查找天气对象：带前缀 → 裸名 → weathers() Seq 扫描
    function findWeather(){
        var names = [T_MOD_ID + "-" + WEATHER_KEY, WEATHER_KEY];
        for(var i = 0; i < names.length; i++){
            try {
                var w = Vars.content.weather(names[i]);
                if(w) return w;
            } catch(e) {}
        }
        try {
            var ws = Vars.content.weathers();
            if(ws && ws.size !== undefined){
                for(var j = 0; j < ws.size; j++){
                    var w2 = ws.get(j);
                    if(w2 && w2.name && w2.name.indexOf(WEATHER_KEY) >= 0) return w2;
                }
            }
        } catch(e2) {}
        return null;
    }

    var weatherRef = null;
    var lastFailLog = "";

    function tryInject(){
        try {
            if(!Vars.state || !Vars.state.isGame() || !Vars.state.rules) return;
            var rules = Vars.state.rules;
            // 只作用于拉莱耶星球的战役区块
            var sector = rules.sector;
            if(!sector || !sector.planet || !sector.planet.name) return;
            if(sector.planet.name.indexOf(PLANET_KEY) < 0) return;
            if(!rules.weather) return;

            // 懒加载天气对象（等 content 全部注册完成）
            if(!weatherRef) weatherRef = findWeather();
            if(!weatherRef) return;

            // 已注入则跳过
            for(var i = 0; i < rules.weather.size; i++){
                var e = rules.weather.get(i);
                if(e && e.weather === weatherRef) return;
            }

            // 构造 WeatherEntry（Weather 的公开静态内部类，提供模组用无参构造器）
            var entry = null;
            try { entry = new Weather.WeatherEntry(); } catch(e1) {}
            if(!entry){
                try { entry = Weather.WeatherEntry.newInstance(); } catch(e2) {}
            }
            if(!entry){
                if(lastFailLog !== "ctor"){
                    lastFailLog = "ctor";
                    wlog("cannot construct WeatherEntry (Weather global may be unavailable)");
                }
                return;
            }

            entry.weather = weatherRef;
            entry.always = true;
            entry.intensity = 1.0;
            rules.weather.add(entry);
            wlog("injected always-on weather '" + weatherRef.name + "' into " + sector.planet.name);
        } catch(eAll) {}
    }

    // 每局游戏 rules 会重建，因此以低频轮询保证每局注入一次
    try {
        Timer.schedule(function(){ tryInject(); }, 1.0, 2.0);
    } catch(e) {
        wlog("Timer.schedule failed: " + e);
    }
})();
