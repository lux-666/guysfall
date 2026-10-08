export const LOCATIONS = { laboratory:'实验室', engine:'轮机舱', security:'安保室', cargo:'货舱', medbay:'医务室', comms:'通讯舱', archive:'文书室', kitchen:'厨房', bridge:'谈话台' };
export const CREW_DATA = [
  { id: 'scientist', accessAsset: 'oxygen', name: '沈', role: '科学家', station: '实验室', location: 'laboratory', specialty: 'analysis', personality: '只信数据，不愿把猜测写成结论', goal: '保住可验证的证据' },
  { id: 'engineer', accessAsset: 'oxygen', name: '林', role: '工程师', station: '轮机舱', location: 'engine', specialty: 'oxygen', personality: '务实、怕担责，倾向先恢复运行', goal: '把故障压下去，避免无谓浪费' },
  { id: 'security', accessAsset: 'power', name: '卫', role: '安保官', station: '安保室', location: 'security', specialty: 'power', personality: '多疑，依赖程序和出入记录', goal: '维持秩序和可核对的责任链' },
  { id: 'storekeeper', accessAsset: 'supplies', name: '乔', role: '仓储官', station: '货舱', location: 'cargo', specialty: 'supplies', personality: '精于算计，记得每一笔人情', goal: '留足备件，不做亏本交易' },
  { id: 'medic', accessAsset: 'oxygen', name: '许', role: '医官', station: '医务室', location: 'medbay', specialty: 'medical', personality: '中立、守秘密，重视材料保全', goal: '让船员活着到达，避免无依据的指控' },
  { id: 'comms', accessAsset: 'power', name: '陆', role: '通讯员', station: '通讯舱', location: 'comms', specialty: 'communication', personality: '好奇、话多，喜欢交换消息', goal: '让信息流动起来，别被蒙在鼓里' },
  { id: 'clerk', accessAsset: 'power', name: '闻', role: '书记员', station: '文书室', location: 'archive', specialty: 'archive', personality: '谨慎、重程序，会追问证据来源', goal: '保住航程记录和可追溯的事实' },
  { id: 'cook', accessAsset: 'supplies', name: '陶', role: '厨师', station: '厨房', location: 'kitchen', specialty: 'social', personality: '热心，想在抵达前办一次聚餐', goal: '维系船员关系，不让恐慌压垮大家' }
];
export const CREW = CREW_DATA.map(c => c.id);
export const NAMES = Object.fromEntries([...CREW_DATA.map(c => [c.id, `${c.role} · ${c.name}`]), ['world', '航程结算'], ['player', '监察官'], ['system', '船载系统']]);
export const RESOURCE_NAMES = { oxygen: 'O₂', power: 'PWR', supplies: 'SUP' };
export const ASSETS = [
  { id: 'oxygen', title: '供氧', location: '轮机舱', locationId: 'engine' },
  { id: 'power', title: '供电', location: '安保室', locationId: 'security' },
  { id: 'supplies', title: '物资', location: '货舱', locationId: 'cargo' }
];
export const VERBS = [ ['repair','修'], ['inspect','查'], ['assign','派'], ['talk','谈'], ['escort','护送'], ['transfer','移交'] ];
export const CARD_TYPES = {
  parts: { title: '备用备件', kind: '物资', description: '维修时提供现成材料；减少 SUP 支出。', affordances: ['repair_material'] },
  oxygen: { title: '应急氧罐', kind: '物资', description: '在维持供氧任务中提供临时氧源。', affordances: ['oxygen_supply'] },
  access: { title: '操作许可', kind: '权限', description: '调查时可以当场处理问题，无需再派一次人。', affordances: ['handle_on_site'] },
  medicine: { title: '应急药箱', kind: '物资', description: '用于医疗/配给处置，补充物资。', affordances: ['medical_supply'] },
  favour: { title: '一次承诺', kind: '关系', description: '交给人物履行一笔人情；完成任务后，请他带回一张备件。', affordances: ['call_favour'] },
  dispatch: { title: '临时调遣令', kind: '权限', description: '本轮可调遣一名非当值人员，仍占用此人物。', affordances: ['off_duty_dispatch'] },
  reveal: { title: '调查委托', kind: '动词', description: '把普通事件的派遣改为调查，取回一件可用物资。', affordances: ['reveal_intent'] }
};
// Historical contract vocabulary only; new event generation cannot award these.
export const COMPONENT_TYPES = {
  maintenance_link: { title:'维护联动组件', kind:'组件', family:'维护联动', trigger:'maintenance', limit:3, effect:'linked_restore', amount:3, description:'成功维护后，按 O₂ → PWR → SUP → O₂ 恢复下一项资源 3；每日最多 3 次。' },
  maintenance_saver: { title:'耗材节流阀', kind:'组件', family:'维护联动', trigger:'maintenance', limit:3, effect:'supplies', amount:1, description:'成功维护后返还 1 SUP；每日最多 3 次。' },
  reserve_cell: { title:'应急蓄能池', kind:'组件', family:'维护联动', trigger:'maintenance', limit:1, effect:'lowest_restore', amount:5, description:'每日首次成功维护后，恢复当前最低资源 5。' },
  evidence_protocol: { title:'离线检测台', kind:'组件', family:'调查补给', trigger:'test', limit:2, effect:'test_power', amount:3, description:'离线测试回收总成时少消耗 3 PWR；每日最多 2 次，次日起生效。测试仍需总成与人手。' },
  investigation_supply: { title:'总成拆解架', kind:'组件', family:'调查补给', trigger:'salvage', limit:2, effect:'supplies', amount:4, description:'实际拆解回收总成后，多回收 4 SUP；每日最多 2 次。调查本身不发物资。' },
  access_recovery: { title:'快拆接头', kind:'组件', family:'调查补给', trigger:'isolation', limit:1, effect:'supplies', amount:2, description:'完成系统隔离后回收安装余料 2 SUP；每日最多 1 次。' },
  salvage_loop: { title:'回收分拣组件', kind:'组件', family:'耗材回收', trigger:'material_use', limit:2, effect:'supplies', amount:4, description:'完成派遣且消耗备件、药箱或氧罐后，返还 4 SUP；每日最多 2 次。' },
  medical_recycler: { title:'无菌回收箱', kind:'组件', family:'耗材回收', trigger:'material_use', limit:1, effect:'medicine', amount:1, description:'完成派遣且消耗药箱后，返还一张药箱；每日最多 1 次。' },
  scrap_exchange: { title:'余料压制机', kind:'组件', family:'耗材回收', trigger:'material_use', limit:1, effect:'parts', amount:1, description:'完成派遣且消耗药箱或氧罐后，获得一张备件；每日最多 1 次。' }
};
// Starting below the cap makes early recovery useful; difficulty still needs playtesting.
export const RULES = { days: 7, initial: 100, startingReserve: 75, duty: 4, energy: 3, supervisionCost: 2, hostBudget: 8, handLimit: 6, eventLimit: 6,
  baseMaintenance: 12, maintenanceDecay: 0.4, maintenanceCost: 2, baseRepair: 12, repairCost: 5,
  dailyLoss: 7, damageLeak: 1, eventPenalty: 9, noiseChance: 6 };
export const EVENT_PROTOTYPES = {
  repair: { duration: 2, routes: [{ id: 'standard', label: '常规抢修', verb: 'repair' }] },
  supply: { duration: 3, reward: 'parts', routes: [{ id: 'standard', label: '整理库存', verb: 'repair' }] },
  investigation: { duration: 2, routes: [{ id: 'standard', label: '核对现场', verb: 'inspect' }] },
  incident: { duration: 2, routes: [{ id: 'standard', label: '控制事故', verb: 'repair' }] },
  cooperation: { duration: 2, workers: 2, penalty: 12, routes: [{ id: 'standard', label: '协作处置', verb: 'repair', workers: 2 }] },
  material: { duration: 2, card: 'parts', penalty: 12, routes: [{ id: 'standard', label: '用备件修复', verb: 'repair', card: 'parts' }] },
  cache: { duration: 2, reward: 'access', routes: [{ id: 'standard', label: '取回权限牌', verb: 'repair' }] },
  morale: { duration: 1, penalty: 0, routes: [{ id: 'standard', label: '组织协调', verb: 'repair' }] },
  // Route execution lives in builds.mjs; ordinary prototypes retain their legacy rules.
  build: { duration: 3, penalty: 9 },
  cold_storage: { duration: 3, penalty: 12 }

};
// Only used to remove canned testimony from historical recordings.
export const LEGACY_TESTIMONY_VOICES = {
  scientist: ['数据只能支持这些。', '我保留判断。', '别把我的记录写成猜测。'],
  engineer: ['我把能确认的交代清楚。', '我当时忙着修，别多作推断。', '我只对这段记录负责。'],
  security: ['按记录说话。', '接触机会还不能定罪。', '我不想替谁担保。'],
  storekeeper: ['这笔账我记得。', '账里还有对不上的地方。', '先说好，这不是认罪。'],
  medic: ['我只说亲自掌握的。', '材料还不够。', '别急着伤害任何人。'],
  comms: ['我听到的就这些。', '消息还得核对。', '别把我卷进猜测里。'],
  clerk: ['这段记录有出处。', '请保留原始说法。', '我不会替缺失的记录签字。'],
  cook: ['我把知道的告诉你。', '大家先别互相指责。', '我实在不愿怀疑同伴。']
};
