import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive, ArrowDown, ArrowUp, BarChart3, Check, Clipboard, Copy, Download,
  GripVertical, HardDrive, PackageOpen, PauseCircle, Plus, ShieldCheck,
  Sparkles, Sword, Trash2, Upload, Users, X,
} from "lucide-react";
import { applyEquipmentFieldToAll, catalogChampions, elements, itemsForSlot, makeHero, normalizeHeroEquipmentSlots, skillsForClass, type Catalog, type CatalogItem, type CatalogQuest, type CatalogSkill, type EquipmentApplyField } from "./data/catalog";
import { previewEquipmentStats, type EquipmentPreviewConfig } from "./data/equipmentPreview";
import { encodeOnlineChampionConfig, importOnlineChampionConfig } from "./data/championConfig";
import { decodeOnlineHeroTemplate, encodeOnlineHeroConfig, heroTemplateSnapshotDate, importOnlineHeroConfig, makeHeroFromOnlineTemplate, templatesForClass } from "./data/heroCreationTemplates";
import { desktopBridge } from "./platform/bridge";
import { useWorkspace } from "./state/useWorkspace";
import type { AdventureTask, BuildTemplate, CalculatedSheet, Champion, ChampionEquipmentConfig, ChampionLoadout, ElementType, Hero, LineupSystem, PartyUnit, Quality, SimulationProgress, TaskGroup } from "./types/domain";
import {
  decodeClipboard, encodeClipboard, exportChampionPng, exportHeroPng, exportLineupPng, exportSimulationPng, readClipboard, writeClipboard,
} from "./utils/localTransfer";

type Tab = "champions" | "heroes" | "adventures";
type SortMode = "class" | "element";
const quality: Quality[] = ["普通", "优质", "高级", "史诗", "传说"];
const qualityDisplay: Record<Quality, string> = { 普通: "普通", 优质: "高级", 高级: "无暇", 史诗: "史诗", 传说: "传奇" };
const elementCode: Record<string, Hero["element"]> = { fire: "火", water: "水", earth: "土", air: "风", light: "光", dark: "暗" };
const elementToken: Record<ElementType, "fire" | "water" | "earth" | "air" | "light" | "dark"> = { 火: "fire", 水: "water", 土: "earth", 风: "air", 光: "light", 暗: "dark" };
const equipmentTierByLevel = [1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 10, 10, 11, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15, 16];
type EquipmentPreviewContextValue = EquipmentPreviewConfig & { catalog: Catalog; element?: string | undefined; spirit?: string | undefined };
const EquipmentPreviewContext = createContext<EquipmentPreviewContextValue | undefined>(undefined);

function maxEquipmentTier(level: number) {
  return equipmentTierByLevel[Math.max(0, Math.min(39, level - 1))] ?? 16;
}

function clampOnlineHeroName(value: string): string {
  let weight = 0;
  let result = "";
  for (const character of value) {
    const next = character.charCodeAt(0) > 127 ? 2 : 1;
    if (weight + next > 12) break;
    weight += next;
    result += character;
  }
  return result;
}

function enchantFamily(item: CatalogItem | undefined): Hero["element"] | undefined {
  if (!item?.elements) return undefined;
  return elementCode[item.elements.split("+")[0] ?? ""];
}

function hasAttachmentAffinity(item: CatalogItem | undefined, attachmentId: string | undefined, kind: "element" | "spirit"): boolean {
  if (!item || !attachmentId) return false;
  const affinity = kind === "element" ? item.elementAffinity : item.spiritAffinity;
  return Boolean(affinity?.split(/[;,]/).map((value) => value.trim()).some((value) => value === attachmentId || (kind === "element" && value === "all")));
}

function IconButton({ label, children, onClick, danger = false, disabled = false }: {
  label: string; children: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean;
}) {
  return <button className={`icon-button ${danger ? "danger" : ""}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

function ChoicePicker({ label, value, options, onChange, format = String }: {
  label: string;
  value: number;
  options: number[];
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  const [open, setOpen] = useState(false);
  return <div className="choice-picker">
    <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>{format(value)}</button>
    {open && <div className="choice-picker-menu" role="listbox" aria-label={`${label}选项`}>
      {options.map((option) => <button type="button" role="option" aria-selected={option === value} className={option === value ? "active" : ""} key={option} onClick={() => { onChange(option); setOpen(false); }}>{format(option)}</button>)}
    </div>}
  </div>;
}

function UnitAvatar({ unit, small = false }: { unit: PartyUnit; small?: boolean }) {
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);
  const sprite = unit.spritePath;
  useEffect(() => {
    setFailed(false);
    if (!sprite) { setSource(""); return; }
    void desktopBridge.assetUrl(sprite).then(setSource).catch(() => setFailed(true));
  }, [sprite]);
  return <div className={`unit-avatar element-${unit.element} ${small ? "small" : ""}`} aria-hidden="true">
    {source && !failed ? <img src={source} alt="" onError={() => setFailed(true)} /> : unit.name.slice(0, 1)}
  </div>;
}

function AssetImage({ path, alt, className = "" }: { path?: string | undefined; alt: string; className?: string }) {
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (!path) { setSource(""); return; }
    void desktopBridge.assetUrl(path).then(setSource).catch(() => setFailed(true));
  }, [path]);
  if (!source || failed) return <span className={`asset-fallback ${className}`} aria-hidden="true">{alt.slice(0, 1)}</span>;
  return <img className={className} src={source} alt={alt} onError={() => setFailed(true)} />;
}

function ItemTile({ item, selected, onClick, compact = false, previewConfig }: { item: CatalogItem; selected: boolean; onClick: () => void; compact?: boolean; previewConfig?: EquipmentPreviewConfig }) {
  const pickerPreviewConfig = useContext(EquipmentPreviewContext);
  const activePreviewConfig = previewConfig ?? (compact ? undefined : pickerPreviewConfig);
  const effectiveElementId = item.builtInElementId ?? pickerPreviewConfig?.element;
  const effectiveSpiritId = item.builtInSpiritId ?? pickerPreviewConfig?.spirit;
  const stats = activePreviewConfig ? previewEquipmentStats(item, activePreviewConfig, {
    elementItem: pickerPreviewConfig?.catalog.items.find((candidate) => candidate.id === effectiveElementId),
    spiritItem: pickerPreviewConfig?.catalog.items.find((candidate) => candidate.id === effectiveSpiritId),
  }) : {
    attack: item.attack ?? 0, defense: item.defense ?? 0, health: item.health ?? 0,
    evasion: item.evasion ?? 0, critical: item.critical ?? 0, baseMultiplier: 1,
  };
  const bonuses = [["⚔", stats.attack], ["◆", stats.defense], ["♥", stats.health], ["➟", stats.evasion], ["✹", stats.critical]]
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] !== 0);
  const family = enchantFamily(item);
  const enhanced = Boolean(activePreviewConfig?.shiny || (activePreviewConfig?.transcendence ?? 0) > 0);
  return <button className={`item-tile catalog-tile ${compact ? "compact" : ""} ${selected ? "selected" : ""} ${activePreviewConfig ? "with-preview" : ""} ${enhanced ? "enhanced" : ""}`} onClick={onClick} title={`${item.name} · T${item.tier} · ${item.typeName}`}>
    <span className="item-art"><AssetImage path={item.spritePath} alt={item.name} /><i>T{item.tier}</i>{family && <em className={`element-${family}`}>✦</em>}</span>
    <strong>{item.name}</strong>
    {activePreviewConfig && <span className="item-state-tags">{activePreviewConfig.shiny && <b>星能{item.shinyMultiplier && item.shinyMultiplier !== 1 ? ` ×${item.shinyMultiplier}` : ""}</b>}{activePreviewConfig.transcendence > 0 && <b>超越{item.transcendMultiplier && item.transcendMultiplier !== 1 ? ` ×${item.transcendMultiplier}` : ""}</b>}</span>}
    <small>{bonuses.length ? bonuses.map(([icon, value]) => <span key={icon}>{icon} +{Number.isInteger(value) ? value : `${Math.round(value * 100)}%`}</span>) : <span>{item.skill ? "专属效果" : item.typeName}</span>}</small>
  </button>;
}

function SkillArt({ skill, innate = false, level = 1 }: { skill?: Pick<CatalogSkill, "name" | "spritePath"> | undefined; innate?: boolean; level?: number }) {
  return <span className={`skill-art ${innate ? "innate" : ""}`}>
    {skill ? <AssetImage path={skill.spritePath} alt={skill.name} /> : <span className="empty-skill-glyph">◇</span>}
    {skill && <i>{level}</i>}
  </span>;
}

function ClassPickerModal({ catalog, heroIndex, onChoose, onClose }: { catalog: Catalog; heroIndex: number; onChoose: (hero: Hero) => void; onClose: () => void }) {
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState("");
  const selectedClass = catalog.classes.find((entry) => entry.id === selectedClassId);
  const creationTemplates = selectedClassId ? templatesForClass(selectedClassId) : [];
  const chooseTemplate = (template?: (typeof creationTemplates)[number]) => {
    if (!selectedClass) return;
    try {
      onChoose(template ? makeHeroFromOnlineTemplate(catalog, template, heroIndex) : makeHero(catalog, selectedClass.id, heroIndex));
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : "模板解析失败");
    }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal class-picker-modal" role="dialog" aria-modal="true" aria-labelledby="class-picker-title">
      <header className="modal-header"><div className="class-picker-heading">{selectedClass && <button className="template-back-button" onClick={() => { setSelectedClassId(null); setTemplateError(""); }}>← 返回</button>}<h2 id="class-picker-title">{selectedClass ? `选择创建模板 — ${selectedClass.name}` : "选择英雄职业"}</h2></div><button className="zys-button red" onClick={onClose}>关闭</button></header>
      {!selectedClass && <div className="class-picker-grid">{catalog.classes.map((entry) => <button key={entry.id} onClick={() => setSelectedClassId(entry.id)}>
        <span className={`class-picker-art element-${entry.element}`}><AssetImage path={entry.spritePath} alt={entry.name} /></span><strong>{entry.name}</strong><small>{entry.allElements ? "全" : entry.element}</small>
      </button>)}</div>}
      {selectedClass && <div className="creation-template-stage">
        <button className="creation-template-card" onClick={() => chooseTemplate()}>
          <span className={`creation-template-class element-${selectedClass.element}`}><AssetImage path={selectedClass.spritePath} alt={selectedClass.name} /><small>{selectedClass.name}</small></span>
          <span className="creation-template-content"><strong>空白模板</strong><span className="creation-template-skills">{Array.from({ length: 4 }, (_, index) => <span className="creation-template-skill empty" key={index}><b>?</b><small>无技能</small></span>)}</span></span>
        </button>
        {creationTemplates.map((template) => {
          const config = decodeOnlineHeroTemplate(template);
          return <button className="creation-template-card" key={template.id} onClick={() => chooseTemplate(template)}>
            <span className={`creation-template-class element-${selectedClass.element}`}><AssetImage path={selectedClass.spritePath} alt={selectedClass.name} /><small>{selectedClass.name}</small></span>
            <span className="creation-template-content"><strong>{template.name}</strong><span className="creation-template-skills">{Array.from({ length: 4 }, (_, index) => {
              const skill = catalog.skills.find((entry) => entry.id === config.skills?.[index]);
              return <span className={`creation-template-skill ${skill ? "" : "empty"}`} key={index}>{skill ? <AssetImage path={skill.spritePath} alt={skill.name} /> : <b>?</b>}<small>{skill?.name ?? "无技能"}</small></span>;
            })}</span></span>
          </button>;
        })}
        <p className="creation-template-disclaimer">模板仅用于在阵容工具内快速载入模拟配置，不代表配装攻略或强度建议；请以实际游戏与自身需求为准。</p>
        <small className="template-snapshot-date">本地模板快照：{new Date(heroTemplateSnapshotDate).toLocaleDateString("zh-CN")}</small>
        {templateError && <div className="transfer-status" role="alert">{templateError}</div>}
      </div>}
    </section>
  </div>;
}

function StatStrip({ unit }: { unit: PartyUnit }) {
  return <div className="stat-strip">
    <span title="攻击">⚔ {unit.stats.attack.toLocaleString()}</span>
    <span title="防御">◆ {unit.stats.defense.toLocaleString()}</span>
    <span title="生命">♥ {unit.stats.health.toLocaleString()}</span>
  </div>;
}

function HeroCard({ hero, onEdit, onCopy, onDelete }: {
  hero: Hero; onEdit: () => void; onCopy: () => void; onDelete: () => void;
}) {
  return <article className="unit-card hero-icon-card" draggable onDragStart={(event) => {
    event.dataTransfer.setData("application/x-zys-unit", hero.id);
    event.dataTransfer.effectAllowed = "copy";
  }}>
    <button className="unit-icon-open" aria-label="配装" title={hero.equipment.find((entry) => entry.name)?.name} onClick={onEdit}><UnitAvatar unit={hero} /><strong>{hero.name}</strong><small>{hero.className}</small></button>
    <button className="unit-remove" aria-label="删除英雄" title="删除英雄" onClick={onDelete}><X size={11} /></button>
    <button className="unit-copy" aria-label="复制英雄" title="复制英雄" onClick={onCopy}><Copy size={11} /></button>
  </article>;
}

function ChampionCard({ unit, onEdit }: { unit: PartyUnit; onEdit: () => void }) {
  return <article className="champion-card champion-icon-card selected" draggable onDragStart={(event) => {
    event.dataTransfer.setData("application/x-zys-unit", unit.id);
    event.dataTransfer.effectAllowed = "copy";
  }}>
    <button className="unit-icon-open" aria-label={`勇士配装 ${unit.name}`} title={`${unit.name} · Lv.${unit.level} · Rank ${unit.rank}`} onClick={onEdit}><UnitAvatar unit={unit} /><strong>{unit.name}</strong><small>{unit.element}</small></button>
  </article>;
}

function EquipmentModal({ hero, catalog, templates, onClose, onPrevious, onNext, onClone, onSave, onSaveTemplate }: {
  hero: Hero; catalog: Catalog; templates: BuildTemplate[]; onClose: () => void; onSave: (hero: Hero, sheet: CalculatedSheet) => void | Promise<void>;
  onPrevious: () => void; onNext: () => void; onClone: (hero: Hero) => void;
  onSaveTemplate: (name: string, hero: Hero) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => normalizeHeroEquipmentSlots(structuredClone(hero)));
  const [transferStatus, setTransferStatus] = useState("");
  const [importText, setImportText] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [heroNameDraft, setHeroNameDraft] = useState(draft.name);
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerEquipment, setPickerEquipment] = useState<Hero["equipment"] | null>(null);
  const [pickerConfig, setPickerConfig] = useState<EquipmentPreviewConfig>({ quality: "普通", shiny: false, transcendence: 0 });
  const [itemSearch, setItemSearch] = useState("");
  const [skillPickerIndex, setSkillPickerIndex] = useState<number | null>(null);
  const [sheet, setSheet] = useState<CalculatedSheet | null>(null);
  const [calculating, setCalculating] = useState(false);
  const initialDraftRef = useRef(JSON.stringify(draft));
  const onSaveRef = useRef(onSave);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  const heroTemplates = templates.filter((template) => template.build.kind === "hero" && (!template.classId || template.classId === hero.classId));
  const heroClass = catalog.classes.find((entry) => entry.id === draft.classId);
  const innateSkill = catalog.skills.find((skill) => skill.family === heroClass?.innateSkillFamily && skill.tier === 1);
  const selectableSkills = skillsForClass(catalog, draft.classId);
  const currentSkill = (family: string | undefined) => {
    if (!family) return undefined;
    const elementValue = sheet?.stats.elementValue ?? 0;
    return catalog.skills.filter((skill) => skill.family === family && skill.tier <= (heroClass?.maxSkillLevel ?? 3) && skill.elements <= elementValue)
      .sort((left, right) => right.tier - left.tier)[0]
      ?? catalog.skills.find((skill) => skill.family === family && skill.tier === 1);
  };
  const currentInnateSkill = currentSkill(heroClass?.innateSkillFamily) ?? innateSkill;
  const slot = (pickerEquipment ?? draft.equipment)[selectedSlot]!;
  const slotItem = catalog.items.find((candidate) => candidate.id === slot.itemId);
  const selectedElementId = slotItem?.builtInElementId ?? slot.element;
  const selectedSpiritId = slotItem?.builtInSpiritId ?? slot.spirit;
  const slotItems = useMemo(() => itemsForSlot(catalog, hero.classId, selectedSlot).filter((item) => item.tier <= maxEquipmentTier(draft.level) && (!itemSearch.trim() || `${item.name} ${item.typeName} ${item.tier}`.toLowerCase().includes(itemSearch.trim().toLowerCase())))
    .sort((left, right) => right.tier - left.tier || (right.level ?? 0) - (left.level ?? 0) || (left.sourceOrder ?? 0) - (right.sourceOrder ?? 0)), [catalog, draft.level, hero.classId, itemSearch, selectedSlot]);
  const elementItems = useMemo(() => catalog.items.filter((item) => item.itemType === "z" && Boolean(item.elements) && (!itemSearch.trim() || `${item.name} ${item.typeName} ${item.tier}`.toLowerCase().includes(itemSearch.trim().toLowerCase())))
    .sort((left, right) => right.tier - left.tier || left.name.localeCompare(right.name)), [catalog, itemSearch]);
  const spiritItems = useMemo(() => catalog.items.filter((item) => item.itemType === "z" && Boolean(item.skill) && (!itemSearch.trim() || `${item.name} ${item.typeName} ${item.tier}`.toLowerCase().includes(itemSearch.trim().toLowerCase())))
    .sort((left, right) => right.tier - left.tier || left.name.localeCompare(right.name)), [catalog, itemSearch]);
  useEffect(() => {
    let active = true;
    setCalculating(true);
    void desktopBridge.calculateHero(draft).then(async (next) => {
        if (active) setSheet(next);
        if (JSON.stringify(draft) !== initialDraftRef.current) {
          const synced = { ...draft, stats: { attack: next.stats.attack, defense: next.stats.defense, health: next.stats.health, evasion: next.stats.evasion, crit: next.stats.critical } };
          await onSaveRef.current(synced, next);
          if (active) setTransferStatus(next.issues.some((issue) => issue.severity === "error")
            ? "修改已同步；存在未计入属性的无效配置，请查看校验提示"
            : "修改已实时同步到当前体系");
        }
      })
      .catch((error) => { if (active) setTransferStatus(error instanceof Error ? error.message : "实时计算失败"); })
      .finally(() => { if (active) setCalculating(false); });
    return () => { active = false; };
  }, [draft]);
  const updateSlot = (patch: Partial<Hero["equipment"][number]>) => {
    const equipment = [...(pickerEquipment ?? draft.equipment)];
    equipment[selectedSlot] = { ...equipment[selectedSlot]!, ...patch };
    setPickerEquipment(equipment);
  };
  const applySlotFieldToAll = (field: EquipmentApplyField) => {
    const source = { ...slot, ...pickerConfig };
    setPickerEquipment(applyEquipmentFieldToAll(pickerEquipment ?? draft.equipment, catalog, source, field));
  };
  const openEquipmentPicker = (index: number) => {
    const selected = draft.equipment[index]!;
    setSelectedSlot(index);
    setItemSearch("");
    setPickerEquipment(structuredClone(draft.equipment));
    setPickerConfig({ quality: selected.quality, shiny: selected.shiny, transcendence: selected.transcendence });
    setPickerOpen(true);
  };
  const commitEquipmentPicker = () => {
    if (pickerEquipment) setDraft({ ...draft, equipment: pickerEquipment });
    setPickerEquipment(null);
    setPickerOpen(false);
  };
  const copyLoadout = async () => {
    try { await writeClipboard(encodeOnlineHeroConfig(draft)); setTransferStatus("线上兼容英雄配置码已复制"); }
    catch (error) { setTransferStatus(error instanceof Error ? error.message : "复制失败"); }
  };
  const pasteLoadout = async () => {
    try {
      const text = importText.trim() || await readClipboard();
      if (!text) return;
      let imported: Hero;
      try { imported = decodeClipboard(text, "hero"); }
      catch { imported = importOnlineHeroConfig(catalog, text, hero); }
      setDraft({ ...imported, id: hero.id });
      setImportText("");
      setTransferStatus("英雄配装已校验并载入，正在实时同步");
    } catch (error) { setTransferStatus(error instanceof Error ? error.message : "粘贴失败"); }
  };
  return <EquipmentPreviewContext.Provider value={{ ...slot, ...pickerConfig, catalog }}><div className="modal-backdrop equipment-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <button className="equipment-hero-nav previous" aria-label="上一个英雄" onClick={onPrevious}>‹</button>
    <section className="modal equipment-modal equipment-studio" role="dialog" aria-modal="true" aria-labelledby="equipment-title">
      <header className="modal-header">
        <div><span className="eyebrow">英雄配装模拟</span><h2 id="equipment-title">{draft.name} <small>{draft.className} · {draft.element}</small></h2></div>
        <div className="modal-header-actions"><button className="zys-button blue" onClick={() => void pasteLoadout()}>导入</button><input className="modal-import-code" aria-label="粘贴配置码" placeholder="粘贴配置码" value={importText} onChange={(event) => setImportText(event.target.value)} /><button className="zys-button violet" onClick={() => void copyLoadout()}>导出</button><button className="zys-button purple" onClick={() => onClone(draft)}>克隆</button><button className="zys-button blue" onClick={() => void exportHeroPng(draft, sheet ?? undefined).then(() => setTransferStatus("英雄配装图片已导出")).catch((error: unknown) => setTransferStatus(error instanceof Error ? error.message : "图片导出失败"))}>导出图片</button><button className="zys-button red" onClick={onClose}>关闭</button></div>
      </header>
      <div className="hero-parameter-bar">
        <div className="hero-identity"><UnitAvatar unit={draft} /><div className="hero-name-editor"><small>英雄名称</small>{editingName ? <input aria-label="英雄名称" autoFocus value={heroNameDraft} onChange={(event) => setHeroNameDraft(event.target.value)} onBlur={() => { const name = clampOnlineHeroName(heroNameDraft) || draft.name; setHeroNameDraft(name); setDraft({ ...draft, name }); setEditingName(false); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setHeroNameDraft(draft.name); setEditingName(false); } }} /> : <button type="button" title="点击改名" onClick={() => { setHeroNameDraft(draft.name); setEditingName(true); }}>{draft.name}</button>}</div></div>
        <label>英雄等级<ChoicePicker label="英雄等级" value={draft.level} options={Array.from({ length: 50 }, (_, index) => index + 1)} onChange={(level) => setDraft({ ...draft, level })} /></label>
        <label>最大装备阶数<strong className="parameter-readonly">{maxEquipmentTier(draft.level)}</strong></label>
        <label>种子数量<ChoicePicker label="种子数量" value={draft.seed} options={Array.from({ length: 81 }, (_, index) => index)} onChange={(seed) => setDraft({ ...draft, seed })} /></label>
        <label>收藏卡牌<ChoicePicker label="收藏卡牌" value={draft.cardLevel} options={[0, 1, 2, 3]} onChange={(cardLevel) => setDraft({ ...draft, cardLevel })} /></label>
      </div>
      <section className="hero-skill-stage" aria-label="英雄技能">
        <div className="hero-skill-slots">
          <article className="hero-skill-card innate-card" aria-label={`自带技能 ${innateSkill?.name ?? "未找到"}`}>
            <SkillArt skill={currentInnateSkill} innate level={currentInnateSkill?.tier ?? 1} />
            <span><strong>{innateSkill?.name ?? "职业技能缺失"}</strong></span>
          </article>
          {(heroClass?.skillUnlockLevels ?? []).map((unlockLevel, index) => {
            if (unlockLevel === 0) return null;
            const selected = catalog.skills.find((skill) => skill.id === draft.skills[index]);
            const resolved = currentSkill(selected?.family) ?? selected;
            const unlocked = draft.level >= unlockLevel;
            return <button key={index} disabled={!unlocked} className={`hero-skill-card elective-card ${selected ? "configured" : ""} ${unlocked ? "" : "locked"}`} aria-label={`技能 ${unlocked ? selected?.name ?? "未选择" : `${unlockLevel}级解锁`}`} onClick={() => setSkillPickerIndex(index)}>
              <SkillArt skill={resolved} level={resolved?.tier ?? 1} />
              <span><strong>{unlocked ? selected?.name ?? "未选择" : `${unlockLevel}级解锁`}</strong></span>
            </button>;
          })}
        </div>
        <div className="innate-effect"><div>{(currentInnateSkill?.effects.length ? currentInnateSkill.effects : ["职业自带技能随职业自动配置"]).map((effect) => <strong key={effect}>{effect}</strong>)}{heroClass?.allElements && <strong>可以使用任意元素，但只能对元素屏障造成50%伤害。</strong>}</div></div>
      </section>
      {skillPickerIndex !== null && <div className="nested-picker-backdrop skill-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSkillPickerIndex(null); }}>
        <section className="skill-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="skill-picker-title">
          <header><h3 id="skill-picker-title">选择技能</h3><div>{draft.skills[skillPickerIndex] && <button className="clear-skill-button" onClick={() => { const skills = [...draft.skills]; skills[skillPickerIndex] = ""; setDraft({ ...draft, skills }); setSkillPickerIndex(null); }}>清空技能</button>}<button className="zys-button red" onClick={() => setSkillPickerIndex(null)}>关闭</button></div></header>
          <div className="skill-picker-grid">
            {selectableSkills.map((skill) => {
              const maxSkill = catalog.skills.filter((candidate) => candidate.family === skill.family).sort((left, right) => right.tier - left.tier)[0] ?? skill;
              const selectedElsewhere = draft.skills.some((id, index) => index !== skillPickerIndex && catalog.skills.find((candidate) => candidate.id === id)?.family === skill.family);
              const selectedHere = catalog.skills.find((candidate) => candidate.id === draft.skills[skillPickerIndex])?.family === skill.family;
              return <button key={skill.family} aria-label={`选择技能 ${skill.name}`} disabled={selectedElsewhere} className={`skill-catalog-card rarity-${skill.rarity} ${selectedHere ? "selected" : ""}`} onClick={() => {
                const skills = [...draft.skills];
                while (skills.length <= skillPickerIndex) skills.push("");
                skills[skillPickerIndex] = skill.id;
                setDraft({ ...draft, skills });
                setSkillPickerIndex(null);
              }}>
                <SkillArt skill={skill} />
                <strong>{skill.name}</strong>
                <div>{skill.effects.slice(0, 3).map((effect) => <span key={effect}>• {effect}</span>)}</div>
                <small>满级技能效果</small>
                <div className="max-effects">{maxSkill.effects.slice(0, 3).map((effect) => <span key={effect}>• {effect}</span>)}</div>
                {selectedElsewhere && <em>已在其他槽位</em>}
              </button>;
            })}
          </div>
        </section>
      </div>}
      <div className="equipment-overview">
        <aside className="live-sheet overview-stats">
          <div className="workbench-title"><div><strong>实时属性</strong><small>{calculating ? "Rust 计算中…" : "每次选择即时刷新"}</small></div><button className={`tower-preview-button ${draft.titan ? "active" : ""}`} onClick={() => setDraft({ ...draft, titan: !draft.titan })}>泰坦之塔/墓</button></div>
          {([
            ["生命", "health", "♥"], ["攻击", "attack", "⚔"], ["防御", "defense", "◆"], ["暴击", "critical", "✹"], ["回避", "evasion", "➟"], ["威胁", "aggro", "⚠"], ["元素", "elementValue", "✦"],
          ] as const).map(([label, key, icon]) => {
            const value = sheet?.stats[key] ?? (key === "critical" ? draft.stats.crit : key in draft.stats ? draft.stats[key as keyof typeof draft.stats] : 0);
            const baseKey = key === "critical" ? "crit" : key;
            const base = baseKey in hero.stats ? hero.stats[baseKey as keyof typeof hero.stats] : 0;
            const delta = Number(value) - Number(base);
            return <div className="live-stat" key={key}><span>{icon} {label}</span><strong>{Number(value).toLocaleString()}</strong>{delta !== 0 && <small className={delta > 0 ? "up" : "down"}>{delta > 0 ? "+" : ""}{delta.toLocaleString()}</small>}</div>;
          })}
          {sheet?.issues.length ? <div className="sheet-issues">{sheet.issues.slice(0, 3).map((issue) => <small key={`${issue.code}-${issue.slot ?? ""}`}>{issue.message}</small>)}</div> : <div className="sheet-valid"><ShieldCheck size={15} />当前配装通过本地规则校验</div>}
        </aside>
        <section className="equipment-slot-stage"><div className="workbench-title"><div><strong>六槽装备</strong><small>点击装备槽打开装备、元素附魔和精萃附魔选择</small></div></div><div className="equipment-slot-grid">{draft.equipment.map((entry, index) => {
          const item = catalog.items.find((candidate) => candidate.id === entry.itemId);
          const effectiveElementId = item?.builtInElementId ?? entry.element;
          const effectiveSpiritId = item?.builtInSpiritId ?? entry.spirit;
          const elementAffinity = Boolean(item?.builtInElementId) || hasAttachmentAffinity(item, effectiveElementId, "element");
          const spiritAffinity = Boolean(item?.builtInSpiritId) || hasAttachmentAffinity(item, effectiveSpiritId, "spirit");
          return <button key={entry.slot} aria-label={`${entry.slot}装备槽`} className={`overview-slot quality-${entry.quality}`} onClick={() => openEquipmentPicker(index)}>
            <span className="overview-slot-art">{item ? <AssetImage path={item.spritePath} alt={item.name} /> : <span>{entry.slot.slice(0, 1)}</span>}</span><strong>{item?.name ?? entry.slot}</strong><small>{item ? `T${item.tier} · ${qualityDisplay[entry.quality]}` : "点击选择装备"}</small>{effectiveElementId && (() => { const family = enchantFamily(catalog.items.find((candidate) => candidate.id === effectiveElementId)) ?? (elements.includes(effectiveElementId as Hero["element"]) ? effectiveElementId as Hero["element"] : undefined); return family ? <i className={`element-${family}`}>{family}</i> : null; })()}<span className="slot-affinity-badges">{elementAffinity && <b title="元素附魔获得 50% 亲和加成">元素亲和</b>}{spiritAffinity && <b title="精萃附魔获得 50% 亲和加成">精萃亲和</b>}</span>
          </button>;
        })}</div></section>
      </div>
      {pickerOpen && <div className="nested-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) commitEquipmentPicker(); }}><section className="equipment-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="equipment-picker-title"><header><h3 id="equipment-picker-title">装备选择 - {selectedSlot + 1}</h3><button className="zys-button red" onClick={commitEquipmentPicker}>关闭</button></header><div className="picker-filter-bar"><div><strong>星能铸造{slot.itemId && <button className="apply-all" onClick={() => applySlotFieldToAll("shiny")}>全部应用</button>}</strong><button className={pickerConfig.shiny ? "active" : ""} onClick={() => setPickerConfig({ ...pickerConfig, shiny: !pickerConfig.shiny })}>{pickerConfig.shiny ? "已开启" : "已关闭"}</button></div><div><strong>超越{slot.itemId && <button className="apply-all" onClick={() => applySlotFieldToAll("transcendence")}>全部应用</button>}</strong><button aria-label={`${slot.slot}超越`} className={pickerConfig.transcendence > 0 ? "active" : ""} onClick={() => setPickerConfig({ ...pickerConfig, transcendence: pickerConfig.transcendence > 0 ? 0 : 1 })}>{pickerConfig.transcendence > 0 ? "已开启" : "已关闭"}</button></div><div className="rarity-row"><strong>稀有度{slot.itemId && <button className="apply-all" onClick={() => applySlotFieldToAll("quality")}>全部应用</button>}</strong>{quality.map((value) => <button key={value} className={pickerConfig.quality === value ? "active" : ""} onClick={() => setPickerConfig({ ...pickerConfig, quality: value })}>{qualityDisplay[value]}</button>)}</div><input aria-label="搜索装备" placeholder="搜索全部图鉴" value={itemSearch} onChange={(event) => setItemSearch(event.target.value)} /></div><div className="equipment-picker-columns"><section><h4>装备 <small>{slotItems.length}</small></h4><div className="item-grid"><button className={`item-tile catalog-tile ${!slot.itemId ? "selected" : ""}`} onClick={() => updateSlot({ itemId: undefined, name: undefined })}><span className="item-art">×</span><strong>不装备</strong><small><span>清空槽位</span></small></button>{slotItems.map((item) => <ItemTile key={item.id} item={item} selected={slot.itemId === item.id} onClick={() => updateSlot(slot.itemId === item.id ? { itemId: undefined, name: undefined } : { itemId: item.id, name: item.name, ...pickerConfig, ...(item.builtInElementId ? { element: undefined } : {}), ...(item.builtInSpiritId ? { spirit: undefined } : {}) })} />)}</div></section><section><h4>元素附魔 <small>{elementItems.length}</small>{selectedElementId && <button className="apply-all" onClick={() => applySlotFieldToAll("element")}>全部应用</button>}</h4><div className="enchant-catalog-grid"><button disabled={Boolean(slotItem?.builtInElementId)} className={`item-tile catalog-tile compact ${!selectedElementId ? "selected" : ""}`} onClick={() => updateSlot({ element: undefined })}><span className="item-art">×</span><strong>无元素</strong><small><span>清空附魔</span></small></button>{elementItems.map((item) => <ItemTile compact key={item.id} item={item} selected={selectedElementId === item.id || enchantFamily(item) === selectedElementId} onClick={() => { if (!slotItem?.builtInElementId) updateSlot({ element: item.id }); }} />)}</div></section><section><h4>精萃附魔 <small>{spiritItems.length}</small>{selectedSpiritId && <button className="apply-all" onClick={() => applySlotFieldToAll("spirit")}>全部应用</button>}</h4><div className="spirit-catalog-grid"><button disabled={Boolean(slotItem?.builtInSpiritId)} className={`item-tile catalog-tile compact ${!selectedSpiritId ? "selected" : ""}`} onClick={() => updateSlot({ spirit: undefined })}><span className="item-art">×</span><strong>无精萃</strong><small><span>清空附魔</span></small></button>{spiritItems.map((item) => <ItemTile compact key={item.id} item={item} selected={selectedSpiritId === item.id || selectedSpiritId === item.name} onClick={() => { if (!slotItem?.builtInSpiritId) updateSlot({ spirit: item.id }); }} />)}</div></section></div><footer><details className="picker-advanced"><summary>自定义装备名称</summary><label>装备名称<input aria-label={`${slot.slot}名称`} value={slot.name ?? ""} onChange={(event) => updateSlot({ name: event.target.value || undefined })} /></label></details><button className="zys-button blue" onClick={commitEquipmentPicker}>完成选择</button></footer></section></div>}
      <div className="validation-note"><ShieldCheck size={17} /> 本地规则引擎会在保存时校验职业、槽位和装备限制。</div>
      <div className="template-row"><label>本地英雄模板<select aria-label="英雄配装模板" defaultValue="" onChange={(event) => {
        const template = heroTemplates.find((entry) => entry.id === event.target.value);
        if (!template || template.build.kind !== "hero") return;
        const payload = structuredClone(template.build.payload as Hero);
        setDraft({ ...payload, id: hero.id, name: draft.name });
        setTransferStatus(`已应用模板“${template.name}”`);
        event.currentTarget.value = "";
      }}><option value="">选择模板…</option>{heroTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label><button className="secondary-button" onClick={() => {
        const name = window.prompt("模板名称", `${draft.className}配装`);
        if (name?.trim()) void onSaveTemplate(name.trim(), draft).then(() => setTransferStatus("模板已保存到 SQLite"));
      }}><PackageOpen size={15} />保存为模板</button></div>
      {transferStatus && <div className="transfer-status" role="status">{transferStatus}</div>}
      <footer className="modal-footer auto-save-footer"><div className="modal-transfer"><button className="secondary-button" onClick={() => void copyLoadout()}><Clipboard size={15} />复制配装</button><button className="secondary-button" onClick={() => void pasteLoadout()}><Upload size={15} />粘贴导入</button></div><span>修改会自动计算并同步，无需另行保存</span></footer>
    </section>
    <button className="equipment-hero-nav next" aria-label="下一个英雄" onClick={onNext}>›</button>
  </div></EquipmentPreviewContext.Provider>;
}

function ChampionEquipmentModal({ champion, catalog, loadout, templates, onClose, onPrevious, onNext, onSave, onSaveTemplate }: {
  champion: Champion; catalog: Catalog; loadout?: ChampionLoadout | undefined; templates: BuildTemplate[]; onClose: () => void; onSave: (loadout: ChampionLoadout, sheet: CalculatedSheet) => void | Promise<void>;
  onPrevious: () => void; onNext: () => void;
  onSaveTemplate: (name: string, loadout: ChampionLoadout) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ChampionLoadout>(() => loadout ?? {
    level: champion.level, rank: champion.rank, seed: 0, cardLevel: champion.cardLevel, titan: false,
    familiar: champion.familiar ?? "", aurasong: champion.aurasong ?? "",
  });
  const [transferStatus, setTransferStatus] = useState("");
  const [importText, setImportText] = useState("");
  const [picker, setPicker] = useState<"familiar" | "aurasong" | null>(null);
  const [pickerEquipment, setPickerEquipment] = useState<{ familiar: ChampionEquipmentConfig; aurasong: ChampionEquipmentConfig } | null>(null);
  const [pickerConfig, setPickerConfig] = useState<EquipmentPreviewConfig>({ quality: "普通", shiny: false, transcendence: 0 });
  const [sheet, setSheet] = useState<CalculatedSheet | null>(null);
  const [calculating, setCalculating] = useState(false);
  const initialDraftRef = useRef(JSON.stringify(draft));
  const onSaveRef = useRef(onSave);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  const championTemplates = templates.filter((template) => template.build.kind === "champion-loadout" && (!template.classId || template.classId === `champion:${champion.id}`));
  const catalogChampion = catalog.champions.find((entry) => entry.id === champion.id);
  const teamSkillLevel = draft.rank >= 10 ? 4 : draft.rank >= 6 ? 3 : draft.rank >= 3 ? 2 : 1;
  const teamSkill = catalogChampion?.teamSkills.find((skill) => skill.id === catalogChampion.teamSkillIds[teamSkillLevel - 1]);
  const familiarItems = catalog.items.filter((item) => item.itemType === "xf").sort((left, right) => right.tier - left.tier || left.name.localeCompare(right.name));
  const auraItems = catalog.items.filter((item) => item.itemType === "xx").sort((left, right) => right.tier - left.tier || left.name.localeCompare(right.name));
  const championElementItems = catalog.items.filter((item) => item.itemType === "z" && Boolean(item.elements)).sort((left, right) => right.tier - left.tier || left.name.localeCompare(right.name));
  const championSpiritItems = catalog.items.filter((item) => item.itemType === "z" && Boolean(item.skill)).sort((left, right) => right.tier - left.tier || left.name.localeCompare(right.name));
  const storedChampionEquipment = {
    familiar: draft.familiarEquipment ?? { itemId: draft.familiar || undefined, quality: "普通" as Quality, shiny: false, transcendence: 0 },
    aurasong: draft.auraSongEquipment ?? { itemId: draft.aurasong || undefined, quality: "普通" as Quality, shiny: false, transcendence: 0 },
  };
  const selectedChampionEquipment = (pickerEquipment ?? storedChampionEquipment)[picker ?? "familiar"];
  const selectedChampionItem = catalog.items.find((item) => item.id === selectedChampionEquipment.itemId);
  const selectedChampionElementId = selectedChampionItem?.builtInElementId ?? selectedChampionEquipment.element;
  const selectedChampionSpiritId = selectedChampionItem?.builtInSpiritId ?? selectedChampionEquipment.spirit;
  const updateChampionEquipment = (patch: Partial<typeof selectedChampionEquipment>) => {
    if (!picker) return;
    setPickerEquipment({ ...(pickerEquipment ?? storedChampionEquipment), [picker]: { ...selectedChampionEquipment, ...patch } });
  };
  const openChampionPicker = (kind: "familiar" | "aurasong") => {
    const equipment = structuredClone(storedChampionEquipment);
    setPickerEquipment(equipment);
    setPickerConfig({ quality: equipment[kind].quality, shiny: equipment[kind].shiny, transcendence: equipment[kind].transcendence });
    setPicker(kind);
  };
  const commitChampionPicker = () => {
    if (pickerEquipment) setDraft({
      ...draft,
      familiar: pickerEquipment.familiar.itemId ?? "",
      aurasong: pickerEquipment.aurasong.itemId ?? "",
      familiarEquipment: pickerEquipment.familiar,
      auraSongEquipment: pickerEquipment.aurasong,
    });
    setPickerEquipment(null);
    setPicker(null);
  };
  const applyChampionFieldToAll = (field: EquipmentApplyField) => {
    const source = { ...selectedChampionEquipment, ...pickerConfig };
    const equipment = pickerEquipment ?? storedChampionEquipment;
    const apply = (entry: ChampionEquipmentConfig) => {
      if (!entry.itemId) return entry;
      const item = catalog.items.find((candidate) => candidate.id === entry.itemId);
      if (field === "element" && item?.builtInElementId) return entry;
      if (field === "spirit" && item?.builtInSpiritId) return entry;
      return { ...entry, [field]: source[field] };
    };
    setPickerEquipment({ familiar: apply(equipment.familiar), aurasong: apply(equipment.aurasong) });
  };
  useEffect(() => {
    let active = true;
    setCalculating(true);
    void desktopBridge.calculateChampion(champion, draft).then(async (next) => {
        if (active) setSheet(next);
        if (JSON.stringify(draft) !== initialDraftRef.current) {
          const synced = { ...draft, stats: { attack: next.stats.attack, defense: next.stats.defense, health: next.stats.health, evasion: next.stats.evasion, crit: next.stats.critical } };
          await onSaveRef.current(synced, next);
          if (active) setTransferStatus(next.issues.some((issue) => issue.severity === "error")
            ? "修改已同步；存在未计入属性的无效配置，请查看校验提示"
            : "修改已实时同步到当前体系");
        }
      })
      .catch((error) => { if (active) setTransferStatus(error instanceof Error ? error.message : "实时计算失败"); })
      .finally(() => { if (active) setCalculating(false); });
    return () => { active = false; };
  }, [champion, draft]);
  const copyLoadout = async () => {
    try { await writeClipboard(encodeOnlineChampionConfig(champion, draft)); setTransferStatus("线上兼容勇士配置码已复制"); }
    catch (error) { setTransferStatus(error instanceof Error ? error.message : "复制失败"); }
  };
  const pasteLoadout = async () => {
    try {
      const text = importText.trim() || await readClipboard();
      if (!text) return;
      try { setDraft(decodeClipboard(text, "champion-loadout")); }
      catch { setDraft(importOnlineChampionConfig(catalog, text, champion)); }
      setImportText("");
      setTransferStatus("勇士配装已校验并载入，正在实时同步");
    } catch (error) { setTransferStatus(error instanceof Error ? error.message : "粘贴失败"); }
  };
  return <EquipmentPreviewContext.Provider value={{ ...selectedChampionEquipment, ...pickerConfig, catalog }}><div className="modal-backdrop equipment-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <button className="equipment-hero-nav previous" aria-label="上一个勇士" onClick={onPrevious}>‹</button>
    <section className="modal champion-modal equipment-studio" role="dialog" aria-modal="true" aria-labelledby="champion-equipment-title">
      <header className="modal-header"><div><span className="eyebrow">勇士配装模拟</span><h2 id="champion-equipment-title">{champion.name} <small>{champion.element}属性勇士</small></h2></div><div className="modal-header-actions"><button className="zys-button blue" onClick={() => void pasteLoadout()}>导入</button><input className="modal-import-code" aria-label="粘贴配置码" placeholder="粘贴配置码" value={importText} onChange={(event) => setImportText(event.target.value)} /><button className="zys-button violet" onClick={() => void copyLoadout()}>导出</button><button className="zys-button blue" onClick={() => void exportChampionPng(champion, draft, sheet ?? undefined).then(() => setTransferStatus("勇士配装图片已导出")).catch((error: unknown) => setTransferStatus(error instanceof Error ? error.message : "图片导出失败"))}>导出图片</button><button className="zys-button red" onClick={onClose}>关闭</button></div></header>
      <div className="hero-parameter-bar champion-parameter-bar">
        <div className="hero-identity"><UnitAvatar unit={champion} /><strong>{champion.name}</strong></div>
        <label>勇士等级<ChoicePicker label="勇士等级" value={draft.level} options={Array.from({ length: 50 }, (_, index) => index + 1)} onChange={(level) => setDraft({ ...draft, level })} /></label>
        <label>最大装备阶数<strong className="parameter-readonly">{maxEquipmentTier(draft.level)}</strong></label>
        <label>勇士阶数<ChoicePicker label="勇士阶数" value={draft.rank} options={Array.from({ length: 71 }, (_, index) => index + 1)} format={(rank) => rank <= 11 ? String(rank) : `11+${rank - 11}`} onChange={(rank) => setDraft({ ...draft, rank })} /></label>
        <label>种子数量<ChoicePicker label="勇士种子数量" value={draft.seed} options={Array.from({ length: 81 }, (_, index) => index)} onChange={(seed) => setDraft({ ...draft, seed })} /></label>
        <label>收藏卡牌<ChoicePicker label="勇士收藏卡牌" value={draft.cardLevel} options={[0, 1, 2, 3]} onChange={(cardLevel) => setDraft({ ...draft, cardLevel })} /><small>({draft.cardLevel === 0 ? 0 : draft.cardLevel === 1 ? 5 : draft.cardLevel === 2 ? 10 : 25}% 攻防血增益)</small></label>
        <label className="titan-toggle"><input type="checkbox" checked={draft.titan} onChange={(event) => setDraft({ ...draft, titan: event.target.checked })} /><span>勇士之魂</span></label>
      </div>
      <section className="champion-team-skill" aria-label="勇士团队技能"><SkillArt skill={teamSkill} innate level={teamSkillLevel} /><div><small>固定团队技能 · 等级 {teamSkillLevel}</small><strong>{teamSkill?.name ?? catalogChampion?.teamSkillIds[teamSkillLevel - 1] ?? "团队技能"}</strong>{teamSkill?.effects.slice(0, 3).map((effect) => <span key={effect}>{effect}</span>)}</div></section>
      <div className="equipment-overview champion-overview">
        <aside className="live-sheet overview-stats"><div className="workbench-title"><div><strong>实时属性</strong><small>{calculating ? "Rust 计算中…" : "配装变化即时刷新"}</small></div><Sparkles size={18} /></div>{([
          ["生命", "health", "♥"], ["攻击", "attack", "⚔"], ["防御", "defense", "◆"], ["暴击", "critical", "✹"], ["回避", "evasion", "➟"], ["威胁", "aggro", "⚠"],
        ] as const).map(([label, key, icon]) => <div className="live-stat" key={key}><span>{icon} {label}</span><strong>{Number(sheet?.stats[key] ?? (key === "critical" ? champion.stats.crit : champion.stats[key as keyof typeof champion.stats] ?? 0)).toLocaleString()}</strong></div>)}{sheet?.issues.length ? <div className="sheet-issues">{sheet.issues.slice(0, 3).map((issue) => <small key={issue.code}>{issue.message}</small>)}</div> : <div className="sheet-valid"><ShieldCheck size={15} />当前配装通过本地规则校验</div>}</aside>
        <section className="equipment-slot-stage"><div className="workbench-title"><div><strong>勇士专属装备</strong><small>点击槽位从完整本地图鉴中选择</small></div></div><div className="champion-slot-grid">{([
          ["familiar", "使魔", draft.familiar, familiarItems], ["aurasong", "光环", draft.aurasong, auraItems],
        ] as const).map(([kind, label, value, items]) => { const config = kind === "familiar" ? draft.familiarEquipment : draft.auraSongEquipment; const itemId = config?.itemId ?? value; const item = items.find((entry) => entry.id === itemId || entry.name === itemId); return <button key={kind} aria-label={`${label}装备槽`} className={`overview-slot champion-slot quality-${config?.quality ?? "普通"}`} onClick={() => openChampionPicker(kind)}><span className="overview-slot-art">{item ? <AssetImage path={item.spritePath} alt={item.name} /> : <span>{label.slice(0, 1)}</span>}</span><strong>{item?.name ?? (itemId || label)}</strong><small>{item ? `T${item.tier} · ${qualityDisplay[config?.quality ?? "普通"]}` : "点击选择装备"}</small></button>; })}</div></section>
      </div>
      {picker && <div className="nested-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) commitChampionPicker(); }}><section className="equipment-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="champion-picker-title"><header><h3 id="champion-picker-title">装备选择 - {picker === "familiar" ? "使魔" : "光环"}</h3><button className="zys-button red" onClick={commitChampionPicker}>关闭</button></header><div className="picker-filter-bar champion-full-filter"><div><strong>星能铸造{selectedChampionEquipment.itemId && <button className="apply-all" onClick={() => applyChampionFieldToAll("shiny")}>全部应用</button>}</strong><button className={pickerConfig.shiny ? "active" : ""} onClick={() => setPickerConfig({ ...pickerConfig, shiny: !pickerConfig.shiny })}>{pickerConfig.shiny ? "已开启" : "已关闭"}</button></div><div><strong>超越{selectedChampionEquipment.itemId && <button className="apply-all" onClick={() => applyChampionFieldToAll("transcendence")}>全部应用</button>}</strong><button className={pickerConfig.transcendence > 0 ? "active" : ""} onClick={() => setPickerConfig({ ...pickerConfig, transcendence: pickerConfig.transcendence > 0 ? 0 : 1 })}>{pickerConfig.transcendence > 0 ? "已开启" : "已关闭"}</button></div><div className="rarity-row"><strong>稀有度{selectedChampionEquipment.itemId && <button className="apply-all" onClick={() => applyChampionFieldToAll("quality")}>全部应用</button>}</strong>{quality.map((value) => <button key={value} className={pickerConfig.quality === value ? "active" : ""} onClick={() => setPickerConfig({ ...pickerConfig, quality: value })}>{qualityDisplay[value]}</button>)}</div></div><div className="equipment-picker-columns"><section><h4>装备</h4><div className="item-grid"><button className={`item-tile catalog-tile ${!selectedChampionEquipment.itemId ? "selected" : ""}`} onClick={() => updateChampionEquipment({ itemId: undefined, name: undefined })}><span className="item-art">×</span><strong>不装备</strong><small><span>清空槽位</span></small></button>{(picker === "familiar" ? familiarItems : auraItems).map((item) => <ItemTile key={item.id} item={item} selected={selectedChampionEquipment.itemId === item.id} onClick={() => updateChampionEquipment(selectedChampionEquipment.itemId === item.id ? { itemId: undefined, name: undefined } : { itemId: item.id, name: item.name, ...pickerConfig, ...(item.builtInElementId ? { element: undefined } : {}), ...(item.builtInSpiritId ? { spirit: undefined } : {}) })} />)}</div></section><section><h4>元素附魔{selectedChampionEquipment.itemId && <button className="apply-all" onClick={() => applyChampionFieldToAll("element")}>全部应用</button>}</h4><div className="enchant-catalog-grid"><button disabled={Boolean(selectedChampionItem?.builtInElementId)} className={`item-tile catalog-tile compact ${!selectedChampionElementId ? "selected" : ""}`} onClick={() => updateChampionEquipment({ element: undefined })}><span className="item-art">×</span><strong>无元素</strong><small><span>清空附魔</span></small></button>{championElementItems.map((item) => <ItemTile compact key={item.id} item={item} selected={selectedChampionElementId === item.id || enchantFamily(item) === selectedChampionElementId} onClick={() => { if (!selectedChampionItem?.builtInElementId) updateChampionEquipment({ element: item.id }); }} />)}</div></section><section><h4>精萃附魔{selectedChampionSpiritId && <button className="apply-all" onClick={() => applyChampionFieldToAll("spirit")}>全部应用</button>}</h4><div className="spirit-catalog-grid"><button disabled={Boolean(selectedChampionItem?.builtInSpiritId)} className={`item-tile catalog-tile compact ${!selectedChampionSpiritId ? "selected" : ""}`} onClick={() => updateChampionEquipment({ spirit: undefined })}><span className="item-art">×</span><strong>无精萃</strong><small><span>清空附魔</span></small></button>{championSpiritItems.map((item) => <ItemTile compact key={item.id} item={item} selected={selectedChampionSpiritId === item.id || selectedChampionSpiritId === item.name} onClick={() => { if (!selectedChampionItem?.builtInSpiritId) updateChampionEquipment({ spirit: item.id }); }} />)}</div></section></div><footer><span /><button className="zys-button blue" onClick={commitChampionPicker}>完成选择</button></footer></section></div>}
      <div className="validation-note"><ShieldCheck size={17} /> 勇士等级、Rank、卡片与专属装备随当前体系保存。</div>
      <div className="template-row"><label>本地勇士模板<select aria-label="勇士配装模板" defaultValue="" onChange={(event) => {
        const template = championTemplates.find((entry) => entry.id === event.target.value);
        if (!template || template.build.kind !== "champion-loadout") return;
        setDraft(structuredClone(template.build.payload as ChampionLoadout));
        setTransferStatus(`已应用模板“${template.name}”`);
        event.currentTarget.value = "";
      }}><option value="">选择模板…</option>{championTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label><button className="secondary-button" onClick={() => {
        const name = window.prompt("模板名称", `${champion.name}配装`);
        if (name?.trim()) void onSaveTemplate(name.trim(), draft).then(() => setTransferStatus("模板已保存到 SQLite"));
      }}><PackageOpen size={15} />保存为模板</button></div>
      {transferStatus && <div className="transfer-status" role="status">{transferStatus}</div>}
      <footer className="modal-footer auto-save-footer"><div className="modal-transfer"><button className="secondary-button" onClick={() => void copyLoadout()}><Clipboard size={15} />复制配装</button><button className="secondary-button" onClick={() => void pasteLoadout()}><Upload size={15} />粘贴导入</button></div><span>修改会自动计算并同步，无需另行保存</span></footer>
    </section>
    <button className="equipment-hero-nav next" aria-label="下一个勇士" onClick={onNext}>›</button>
  </div></EquipmentPreviewContext.Provider>;
}

function TaskCard({ systemId, systemGameVersion, groupId, index, task, units, quests, canDuplicate, onDrop, onTaskDrop, onRemove, onCopy, onDelete, onResult, onChange }: {
  systemId: string; systemGameVersion: string; groupId: string; task: AdventureTask; units: PartyUnit[]; quests: CatalogQuest[];
  index: number; canDuplicate: boolean; onDrop: (id: string) => void; onTaskDrop: (sourceGroupId: string, taskId: string, targetIndex: number) => void;
  onRemove: (id: string) => void; onCopy: () => void; onDelete: () => void;
  onResult: (result: NonNullable<AdventureTask["result"]>) => void; onChange?: (task: AdventureTask) => void;
}) {
  const [progress, setProgress] = useState<SimulationProgress | null>(null);
  const [details, setDetails] = useState(false);
  const [message, setMessage] = useState("");
  const [memberPicker, setMemberPicker] = useState(false);
  const [boosterPicker, setBoosterPicker] = useState(false);
  const [elitePicker, setElitePicker] = useState(false);
  const [barrierPicker, setBarrierPicker] = useState(false);
  const [questPicker, setQuestPicker] = useState(false);
  const [questCategory, setQuestCategory] = useState<CatalogQuest["category"]>("普通冒险");
  const [questMapKey, setQuestMapKey] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const members = task.memberIds.map((id) => units.find((unit) => unit.id === id)).filter(Boolean) as PartyUnit[];
  const boosterLevel = task.config.boosterLevel ?? (task.config.booster ? 1 : 0);
  const boosterNames = ["无", "威力强化品", "超级威力强化品", "特级威力强化品"];
  const eliteKinds = [["none", "无"], ["agile", "敏捷"], ["huge", "巨大"], ["dire", "凶残"], ["wealthy", "富有"], ["epic", "传奇"]] as const;
  const eliteKind = task.config.eliteKind ?? (task.config.elite ? "epic" : "none");
  const currentQuest = quests.find((entry) => entry.id === task.questId);
  const barrierOptions = [...new Set([
    ...quests.filter((entry) => entry.mapKey === currentQuest?.mapKey && entry.difficulty === currentQuest?.difficulty && entry.barrierPower > 0).map((entry) => entry.barrierElement),
    ...elements.filter((element) => (task.barrier[element] ?? 0) > 0),
  ].filter((element): element is ElementType => Boolean(element)))];
  const selectedElement = task.config.selectedElement;
  const selectedElementLabel = selectedElement === "force" ? "无屏障" : selectedElement ? elementCode[selectedElement] : "自动";
  const questMaps = quests.filter((quest, position, all) => quest.category === questCategory
    && all.findIndex((candidate) => candidate.category === questCategory && candidate.mapKey === quest.mapKey) === position);
  const chosenMapQuests = quests.filter((quest) => quest.mapKey === questMapKey)
    .sort((left, right) => left.difficultyLevel - right.difficultyLevel);
  const selectQuest = (quest: CatalogQuest) => {
    onChange?.({ ...task, questId: quest.id, name: quest.name, map: quest.mapName, difficulty: quest.difficulty,
      maxMembers: quest.maxMembers, barrier: quest.barrierElement && quest.barrierPower > 0 ? { [quest.barrierElement]: quest.barrierPower } : {},
      config: { ...task.config, titanTower: quest.category === "泰坦塔", selectedElement: undefined } });
    setQuestPicker(false); setQuestMapKey(null);
  };

  const run = async () => {
    const simulatedTask = task.config.iterations === 10000 ? task : { ...task, config: { ...task.config, iterations: 10000 as const } };
    if (simulatedTask !== task) onChange?.(simulatedTask);
    const next = new AbortController(); controller.current = next;
    setProgress({ taskId: task.id, completed: 0, total: 10000, phase: "queued" });
    try {
      const result = await desktopBridge.simulate({ ...simulatedTask, gameDataVersion: systemGameVersion }, members, setProgress, next.signal, systemId);
      onResult(result);
      setProgress({ taskId: task.id, completed: 10000, total: 10000, phase: "complete" });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const cancelled = next.signal.aborted || (error instanceof DOMException && error.name === "AbortError") || /cancel|cancelled|取消/i.test(detail);
      setProgress(null);
      setMessage(cancelled ? "模拟已取消，可重新开始" : `模拟失败：${detail}`);
    } finally { controller.current = null; }
  };

  const exportResult = async () => {
    if (!task.result) return;
    try { await exportSimulationPng(task, task.result, members); setMessage("模拟结果已导出为 PNG"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "PNG 导出失败"); }
  };

  return <article className="task-card" data-task-name={task.name} draggable onDragStart={(event) => {
    event.dataTransfer.setData("application/x-zys-task", JSON.stringify({ groupId, taskId: task.id }));
    event.dataTransfer.effectAllowed = "move";
  }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = event.dataTransfer.types.includes("application/x-zys-task") ? "move" : "copy"; }} onDrop={(event) => {
    event.preventDefault(); event.stopPropagation();
    const taskPayload = event.dataTransfer.getData("application/x-zys-task");
    if (taskPayload) {
      try {
        const source = JSON.parse(taskPayload) as { groupId?: unknown; taskId?: unknown };
        if (typeof source.groupId === "string" && typeof source.taskId === "string") onTaskDrop(source.groupId, source.taskId, index);
      } catch { setMessage("任务拖拽数据无效"); }
      return;
    }
    const id = event.dataTransfer.getData("application/x-zys-unit");
    if (!id) return;
    if (task.memberIds.includes(id)) { setMessage("同一成员不能在这个任务中重复上阵"); return; }
    if (task.memberIds.length >= task.maxMembers) { setMessage(`该任务最多上阵 ${task.maxMembers} 人`); return; }
    if (!units.some((unit) => unit.id === id)) { setMessage("拖入的成员不在当前体系阵容中"); return; }
    setMessage(""); onDrop(id);
  }}>
    <header className="online-quest-header">
      <button className="quest-switcher" title="点击切换地图" aria-label={`${task.name}切换地图`} onClick={() => { setQuestPicker(true); setQuestMapKey(null); }}><span className="quest-switcher-art">{currentQuest?.spritePath ? <AssetImage path={currentQuest.spritePath} alt={task.map} /> : "◈"}</span></button>
      <div className="online-quest-name"><GripVertical className="task-drag-handle" size={14} /><strong>{task.map}</strong><small>{task.difficulty}</small></div>
      <button className="online-card-action" aria-label="复制任务" disabled={!canDuplicate} onClick={onCopy}>克隆</button>
      {selectedElement && selectedElement !== "force" && <span className="barrier-broken"><b className={`element-dot element-${elementCode[selectedElement]}`}>✦</b>已破盾</span>}
      <button className="online-delete-task" aria-label="删除任务" onClick={onDelete}>×</button>
    </header>
    {questPicker && <div className="nested-picker-backdrop quest-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setQuestPicker(false); setQuestMapKey(null); } }}><section className="quest-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="quest-picker-title"><header><h3 id="quest-picker-title">选择冒险任务</h3><button className="zys-button red" onClick={() => { setQuestPicker(false); setQuestMapKey(null); }}>关闭</button></header><nav>{(["普通冒险", "黄金城", "泰坦塔", "快闪"] as const).map((category) => <button key={category} className={questCategory === category ? "active" : ""} onClick={() => { setQuestCategory(category); setQuestMapKey(null); }}>{category}</button>)}</nav>{questMapKey ? <><button className="quest-picker-back" onClick={() => setQuestMapKey(null)}>← 返回</button><div className="quest-selected-map"><AssetImage path={chosenMapQuests[0]?.spritePath} alt={chosenMapQuests[0]?.mapName ?? "地图"} /><strong>{chosenMapQuests[0]?.mapName}{chosenMapQuests[0]?.isBoss ? " (Boss)" : ""}</strong></div><div className="quest-difficulty-grid">{chosenMapQuests.map((quest) => <button key={quest.id} onClick={() => selectQuest(quest)}><AssetImage path={quest.spritePath} alt={quest.difficulty} /><strong>{quest.difficulty}</strong></button>)}</div></> : <div className="quest-map-grid">{questMaps.map((quest) => <button key={quest.mapKey} onClick={() => quest.category === "泰坦塔" ? selectQuest(quest) : setQuestMapKey(quest.mapKey)}><AssetImage path={quest.spritePath} alt={quest.mapName} /><strong>{quest.category === "泰坦塔" ? quest.difficulty : `${quest.mapName}${quest.isBoss ? " (Boss)" : ""}`}</strong></button>)}</div>}</section></div>}
    <div className="online-task-options">
      <div><span>强化道具</span><button aria-label={`强化道具：${boosterNames[boosterLevel]}`} className={`task-square-option booster-${boosterLevel} ${boosterLevel > 0 ? "active" : ""}`} onClick={() => { setElitePicker(false); setBarrierPicker(false); setBoosterPicker(true); }}>{boosterLevel > 0 ? <><b>♦</b><small>{boosterLevel}</small></> : "+"}</button></div>
      <div className="task-dropdown-container"><span>精英怪</span><button aria-label={`精英怪：${eliteKinds.find(([value]) => value === eliteKind)?.[1]}`} className={eliteKind !== "none" ? "active" : ""} onClick={() => { setBoosterPicker(false); setBarrierPicker(false); setElitePicker(!elitePicker); }}>{eliteKinds.find(([value]) => value === eliteKind)?.[1]}</button>{elitePicker && <div className="compact-task-dropdown" role="listbox" aria-label="精英怪类型">{eliteKinds.map(([value, label]) => <button role="option" aria-selected={eliteKind === value} key={value} className={eliteKind === value ? "active" : ""} onClick={() => { onChange?.({ ...task, config: { ...task.config, elite: value !== "none", eliteKind: value } }); setElitePicker(false); }}>{label}</button>)}</div>}</div>
      {(barrierOptions.length > 0 || selectedElement) && <div className="task-dropdown-container"><span>元素屏障</span><button aria-label={`元素屏障：${selectedElementLabel}`} className={selectedElement ? "active" : ""} onClick={() => { setBoosterPicker(false); setElitePicker(false); setBarrierPicker(!barrierPicker); }}>{selectedElementLabel}</button>{barrierPicker && <div className="compact-task-dropdown barrier-task-dropdown" role="listbox" aria-label="元素屏障选择"><button role="option" aria-selected={!selectedElement} onClick={() => { onChange?.({ ...task, config: { ...task.config, selectedElement: undefined } }); setBarrierPicker(false); }}>自动</button>{barrierOptions.map((element) => <button role="option" aria-selected={selectedElement === elementToken[element]} key={element} className={`element-${element}`} onClick={() => { onChange?.({ ...task, config: { ...task.config, selectedElement: elementToken[element] } }); setBarrierPicker(false); }}>{element}</button>)}<button role="option" aria-selected={selectedElement === "force"} onClick={() => { onChange?.({ ...task, config: { ...task.config, selectedElement: "force" } }); setBarrierPicker(false); }}>无屏障</button></div>}</div>}
      {task.config.titanTower && <label><input type="checkbox" checked onChange={(event) => onChange?.({ ...task, config: { ...task.config, titanTower: event.target.checked } })} />泰坦塔</label>}
    </div>
    {boosterPicker && <div className="nested-picker-backdrop booster-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setBoosterPicker(false); }}><section className="booster-picker-dialog" role="dialog" aria-modal="true" aria-labelledby={`booster-picker-${task.id}`}><header><h3 id={`booster-picker-${task.id}`}>冒险强化道具</h3><button className="zys-button red" onClick={() => setBoosterPicker(false)}>关闭</button></header><strong>威力强化</strong><div>{([1, 2, 3] as const).map((level) => <button key={level} className={boosterLevel === level ? "active" : ""} title={level === 1 ? "攻防 +20% · 暴击 +10%" : level === 2 ? "攻防 +40% · 暴击 +15%" : "攻防 +80% · 暴击 +30% · 暴伤 +50%"} onClick={() => { const nextLevel = boosterLevel === level ? 0 : level; onChange?.({ ...task, config: { ...task.config, booster: nextLevel > 0, boosterLevel: nextLevel } }); setBoosterPicker(false); }}><b className={`booster-gem booster-gem-${level}`}>♦</b><span>{boosterNames[level]}</span></button>)}</div></section></div>}
    <div className="party-dropzone online-party-dropzone">
      {members.map((unit) => <button className="party-member online-party-member" key={unit.id} title={`移除 ${unit.name}`} onClick={() => onRemove(unit.id)}><span className="member-avatar-wrap"><UnitAvatar unit={unit} small /><b className={`member-element element-${unit.element}`}>{unit.element}</b><i>×</i></span><span>{unit.name}</span></button>)}
      {members.length < task.maxMembers && <button className="add-party-member online-add-member" onClick={() => setMemberPicker(!memberPicker)}><Plus size={20} /><span>添加成员</span></button>}
    </div>
    {memberPicker && <div className="member-picker"><strong>选择成员添加到任务</strong><div>{units.filter((unit) => !task.memberIds.includes(unit.id)).map((unit) => <button key={unit.id} onClick={() => { onDrop(unit.id); setMemberPicker(false); }}><UnitAvatar unit={unit} small /><span>{unit.name}<small>{unit.kind === "champion" ? "勇士" : unit.className}</small></span></button>)}</div></div>}
    {message && <div className="task-message" role="status">{message}</div>}
    {progress && progress.phase !== "complete" ? <div className="progress-area online-progress">
      <div className="progress-copy"><span>模拟中 {Math.round(progress.completed / progress.total * 100)}%</span><button className="link-button" onClick={() => controller.current?.abort()}><PauseCircle size={14} />取消</button></div>
      <progress value={progress.completed} max={progress.total} />
    </div> : null}
    <div className="online-result-row">{task.result && <><span className="online-success-icon" aria-label="成功率">☺</span><strong>成功率: {task.result.successRate.toFixed(3)}%</strong><button onClick={() => setDetails(true)}>查看详情</button></>}<button className="online-test-button" onClick={() => void run()} disabled={!members.length}>测试冒险</button></div>
    {task.result?.stale && <small className="stale-result">数据版本已变化，请重新测试</small>}
    {task.result && details && <div className="modal-backdrop simulation-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetails(false); }}><section className="modal simulation-detail-modal" role="dialog" aria-modal="true" aria-labelledby={`simulation-detail-${task.id}`}><header className="modal-header"><h2 id={`simulation-detail-${task.id}`}>冒险模拟详情</h2><div className="modal-header-actions"><button className="zys-button blue" onClick={() => void exportResult()}>下载图片</button><button className="zys-button red" onClick={() => setDetails(false)}>关闭</button></div></header><div className="simulation-quest-banner"><div className="simulation-quest-title"><span className="quest-switcher-art">{currentQuest?.spritePath ? <AssetImage path={currentQuest.spritePath} alt={task.map} /> : "◈"}</span><div><strong>{task.map}</strong><small>{task.difficulty}</small></div></div><dl><div><dt>冒险强化道具</dt><dd>{boosterLevel ? boosterNames[boosterLevel] : "无"}</dd></div><div><dt>精英怪</dt><dd>{eliteKinds.find(([value]) => value === eliteKind)?.[1]}</dd></div><div><dt>元素屏障</dt><dd>{selectedElementLabel}</dd></div></dl></div><div className="simulation-summary"><div><span>尝试次数</span><strong>{(task.result.iterations ?? 10000).toLocaleString()}</strong></div><div><span>成功率</span><strong>{task.result.successRate.toFixed(2)}%</strong></div><div><span>平均回合数</span><strong>{task.result.averageTurns}</strong></div><div><span>最小回合数</span><strong>{task.result.minTurns}</strong></div><div><span>最大回合数</span><strong>{task.result.maxTurns}</strong></div></div><div className="simulation-member-summary">{members.map((unit) => { const memberResult = task.result?.memberResults?.find((entry) => entry.id === unit.id); return <article key={unit.id}><UnitAvatar unit={unit} small /><strong>{unit.name}</strong><span>☺ {(memberResult?.survivalRate ?? task.result!.survivalRate).toFixed(2)}%</span><span>⚔ {Math.round(memberResult?.averageDamage ?? task.result!.averageDamage).toLocaleString()}</span><span>♥ {Math.round(memberResult?.averageRemainingHealth ?? task.result!.averageRemainingHealth).toLocaleString()}</span></article>; })}</div><div className="simulation-members">{members.map((unit) => <article key={unit.id}><UnitAvatar unit={unit} /><div><strong>{unit.name}</strong><small>{unit.kind === "champion" ? "勇士" : unit.className}</small></div><StatStrip unit={unit} /></article>)}</div><footer className="simulation-detail-footer">模拟器 {task.result.simulatorVersion} · 数据 {task.result.gameDataVersion}</footer></section></div>}
  </article>;
}

function AdventureGroup({ systemId, systemGameVersion, group, units, quests, canAddTask, onUpdate, onMove, onDeleteGroup, onAddTask, onDrop, onMoveTask, onRemove, onCopyTask, onDeleteTask, onResult, onTaskChange }: {
  systemId: string; systemGameVersion: string; group: TaskGroup; units: PartyUnit[]; quests: CatalogQuest[]; onUpdate: (group: TaskGroup) => void; onMove: (direction: -1 | 1) => void;
  canAddTask: boolean; onDeleteGroup: () => void;
  onAddTask: () => void; onDrop: (taskId: string, unitId: string) => void; onRemove: (taskId: string, unitId: string) => void;
  onMoveTask: (sourceGroupId: string, taskId: string, targetIndex: number) => void;
  onCopyTask: (task: AdventureTask) => void; onDeleteTask: (taskId: string) => void;
  onResult: (taskId: string, result: NonNullable<AdventureTask["result"]>) => void;
  onTaskChange: (task: AdventureTask) => void;
}) {
  return <section className="task-group">
    <header className="group-header"><div><input className="group-title" value={group.name} onChange={(event) => onUpdate({ ...group, name: event.target.value })} /><span>{group.tasks.length} 个任务</span></div>
      <div className="toolbar"><IconButton label="分组上移" onClick={() => onMove(-1)}><ArrowUp size={15} /></IconButton><IconButton label="分组下移" onClick={() => onMove(1)}><ArrowDown size={15} /></IconButton><IconButton label="删除任务分组" onClick={onDeleteGroup} danger><Trash2 size={15} /></IconButton><button className="secondary-button" disabled={!canAddTask} onClick={onAddTask}><Plus size={15} />添加任务</button></div>
    </header>
    <div className="task-grid" onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-zys-task")) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }} onDrop={(event) => {
      const payload = event.dataTransfer.getData("application/x-zys-task");
      if (!payload) return;
      event.preventDefault();
      try {
        const source = JSON.parse(payload) as { groupId?: unknown; taskId?: unknown };
        if (typeof source.groupId === "string" && typeof source.taskId === "string") onMoveTask(source.groupId, source.taskId, group.tasks.length);
      } catch { /* TaskCard exposes malformed drag feedback when dropped on a card. */ }
    }}>{group.tasks.map((task, index) => <TaskCard key={task.id} systemId={systemId} systemGameVersion={systemGameVersion} groupId={group.id} index={index} task={task} units={units} quests={quests} canDuplicate={canAddTask} onDrop={(unitId) => onDrop(task.id, unitId)} onTaskDrop={onMoveTask} onRemove={(unitId) => onRemove(task.id, unitId)} onCopy={() => onCopyTask(task)} onDelete={() => onDeleteTask(task.id)} onResult={(result) => onResult(task.id, result)} onChange={onTaskChange} />)}
      {!group.tasks.length && <button className="empty-task" disabled={!canAddTask} onClick={onAddTask}><Plus size={22} />在这个分组中添加冒险任务</button>}
    </div>
  </section>;
}

function TemplateManager({ templates, onDelete, onClose }: {
  templates: BuildTemplate[]; onDelete: (id: string) => Promise<void>; onClose: () => void;
}) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal template-modal" role="dialog" aria-modal="true" aria-labelledby="template-title">
      <header className="modal-header"><div><span className="eyebrow">SQLite 本地模板库</span><h2 id="template-title">配装模板</h2></div><IconButton label="关闭" onClick={onClose}><X size={19} /></IconButton></header>
      <p className="muted">在英雄或勇士的配装窗口中保存和应用模板；模板会包含在完整备份中。</p>
      <div className="template-list">{templates.map((template) => <article key={template.id}><div><strong>{template.name}</strong><small>{template.build.kind === "hero" ? "英雄配装" : "勇士配装"}{template.classId ? ` · ${template.classId}` : ""}</small></div><IconButton label={`删除模板 ${template.name}`} danger onClick={() => void onDelete(template.id)}><Trash2 size={15} /></IconButton></article>)}{!templates.length && <div className="empty-state"><PackageOpen size={26} /><h3>还没有配装模板</h3><p>打开任意配装窗口并选择“保存为模板”。</p></div>}</div>
      <footer className="modal-footer"><button className="primary-button" onClick={onClose}>完成</button></footer>
    </section>
  </div>;
}

function SystemEditModal({ system, onClose, onSave }: { system: LineupSystem; onClose: () => void; onSave: (name: string, description: string, localPublic: boolean) => void }) {
  const [name, setName] = useState(system.name);
  const [description, setDescription] = useState(system.description);
  const [localPublic, setLocalPublic] = useState(system.localPublic);
  const commit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, description, localPublic);
    onClose();
  };
  return <div className="modal-backdrop system-edit-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="system-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="system-edit-title">
      <header><h3 id="system-edit-title">编辑体系</h3><button aria-label="关闭编辑体系" onClick={onClose}>×</button></header>
      <div className="system-edit-tab">编辑</div>
      <div className="system-edit-form">
        <label>体系名称<input aria-label="体系名称" maxLength={40} placeholder="请输入体系名称" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>体系描述（选填）<textarea aria-label="体系描述" maxLength={200} placeholder="用于在本地收藏中展示该体系的简介" value={description} onChange={(event) => setDescription(event.target.value)} /><small>{description.length}/200</small></label>
        <fieldset><legend>公开设置</legend><label><input type="radio" name="system-visibility" checked={localPublic} onChange={() => setLocalPublic(true)} />公开（允许在本地收藏中展示，便于从本机一键导入）</label><label><input type="radio" name="system-visibility" checked={!localPublic} onChange={() => setLocalPublic(false)} />私有（仅当前体系列表可见，不在本地收藏展示）</label></fieldset>
      </div>
      <footer><button className="system-edit-cancel" onClick={onClose}>取消</button><button className="zys-button blue" disabled={!name.trim()} onClick={commit}>保存</button></footer>
    </section>
  </div>;
}

function SystemCreateModal({ onClose, onCreate, onImport }: {
  onClose: () => void;
  onCreate: (name: string, description: string, localPublic: boolean) => void;
  onImport: (code: string) => string | undefined;
}) {
  const [mode, setMode] = useState<"create" | "import">("create");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [localPublic, setLocalPublic] = useState(true);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const commit = () => {
    if (mode === "create") {
      const trimmed = name.trim();
      if (!trimmed) return;
      onCreate(trimmed, description, localPublic);
      onClose();
      return;
    }
    const nextError = onImport(code.trim());
    if (nextError) setError(nextError);
    else onClose();
  };
  return <div className="modal-backdrop system-edit-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="system-edit-dialog system-create-dialog" role="dialog" aria-modal="true" aria-labelledby="system-create-title">
      <header><h3 id="system-create-title">新增体系</h3><button aria-label="关闭新增体系" onClick={onClose}>×</button></header>
      <nav className="system-create-tabs" aria-label="新增体系方式"><button className={mode === "create" ? "active" : ""} onClick={() => { setMode("create"); setError(""); }}>创建新体系</button><button className={mode === "import" ? "active" : ""} onClick={() => { setMode("import"); setError(""); }}>口令导入</button></nav>
      {mode === "create" ? <div className="system-edit-form">
        <label>体系名称<input type="text" aria-label="新体系名称" maxLength={40} placeholder="请输入体系名称" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>体系描述（选填）<textarea aria-label="新体系描述" maxLength={200} placeholder="用于在本地收藏中展示该体系的简介" value={description} onChange={(event) => setDescription(event.target.value)} /><small>{description.length}/200</small></label>
        <fieldset><legend>公开设置</legend><label><input type="radio" name="new-system-visibility" checked={localPublic} onChange={() => setLocalPublic(true)} />公开（允许在本地收藏中展示，便于从本机一键导入）</label><label><input type="radio" name="new-system-visibility" checked={!localPublic} onChange={() => setLocalPublic(false)} />私有（仅当前体系列表可见，不在本地收藏展示）</label></fieldset>
      </div> : <div className="system-import-form"><textarea aria-label="粘贴体系配置码" placeholder="粘贴体系配置码" value={code} onChange={(event) => { setCode(event.target.value); setError(""); }} />{error && <p role="alert">{error}</p>}</div>}
      <footer><button className="system-edit-cancel" onClick={onClose}>取消</button><button className="zys-button blue" disabled={mode === "create" ? !name.trim() : !code.trim()} onClick={commit}>{mode === "create" ? "创建" : "导入体系"}</button></footer>
    </section>
  </div>;
}

function SystemSidebar({ systems, activeId, dirty, contentVersion, onSelect, onCreate, onDuplicate, onDelete, onSave, onImport, onExport, onBackup, onRestore, onDataUpdate, onRename, onImportCode, onUseCollection }: {
  systems: LineupSystem[]; activeId: string; dirty: boolean; onSelect: (id: string) => boolean; onCreate: (name: string, description: string, localPublic: boolean) => void;
  contentVersion: string; onDuplicate: () => void; onDelete: () => void; onSave: () => void; onImport: () => void; onExport: (system?: LineupSystem) => void;
  onBackup: () => void; onRestore: () => void; onDataUpdate: () => void; onRename: (name: string, description: string, localPublic: boolean) => void;
  onImportCode: (code: string) => string | undefined; onUseCollection: (system: LineupSystem) => void;
}) {
  const [editingSystemId, setEditingSystemId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [managerTab, setManagerTab] = useState<"mine" | "collection">("mine");
  const [collectionSearch, setCollectionSearch] = useState("");
  const editingSystem = systems.find((system) => system.id === editingSystemId);
  const collection = systems.filter((system) => system.localPublic && `${system.name}\n${system.description}`.toLocaleLowerCase().includes(collectionSearch.trim().toLocaleLowerCase()));
  return <section className="system-manager" aria-labelledby="system-manager-title">
    <header className="system-manager-header"><div className="system-manager-title"><h2 id="system-manager-title">体系管理</h2><button className={`manager-tab ${managerTab === "mine" ? "active" : ""}`} onClick={() => setManagerTab("mine")}>我的体系</button><button className={`manager-tab ${managerTab === "collection" ? "active" : ""}`} onClick={() => setManagerTab("collection")}>本地收藏</button></div><div className="manager-actions"><button className="zys-button purple" onClick={() => setCreating(true)}>新增体系</button><button className="zys-button green" onClick={onSave}>{dirty ? "保存当前体系" : "当前体系已保存"}</button></div></header>
    <div className="system-manager-body">{managerTab === "mine" ? <nav className="system-card-list">{systems.map((system) => <article key={system.id} className={`online-system-card ${system.id === activeId ? "active" : ""}`} onClick={() => onSelect(system.id)}>
      <strong>{system.name}</strong>{system.description && <small>{system.description}</small>}
      <p>英雄: {system.heroes.length} <span>|</span> 任务: {system.taskGroups.reduce((sum, group) => sum + group.tasks.length, 0)} <span>|</span> {system.localPublic ? "公开" : "私有"}</p>
      <div><button className="zys-button blue" onClick={(event) => { event.stopPropagation(); if (system.id === activeId || onSelect(system.id)) setEditingSystemId(system.id); }}>编辑</button><button className="zys-button violet" onClick={(event) => { event.stopPropagation(); onExport(system); }}>导出口令</button></div>
    </article>)}</nav> : <section className="local-collection"><div className="collection-search"><input aria-label="搜索本地收藏" placeholder="搜索体系名称 / 描述" value={collectionSearch} onChange={(event) => setCollectionSearch(event.target.value)} /><button className="zys-button blue">搜索</button></div><div className="collection-grid">{collection.map((system) => <article key={system.id} className="collection-card"><span className="collection-source">本地</span><strong>{system.name}</strong>{system.description && <small>{system.description}</small>}<p>英雄: {system.heroes.length} <span>|</span> 任务: {system.taskGroups.reduce((sum, group) => sum + group.tasks.length, 0)}</p><button className="zys-button blue" onClick={() => { onUseCollection(system); setManagerTab("mine"); }}>使用体系</button></article>)}{!collection.length && <div className="empty-state"><Archive size={26} /><h3>没有匹配的本地收藏</h3><p>把体系设置为“公开”后会出现在这里。</p></div>}</div></section>}
      <details className="local-maintenance"><summary><HardDrive size={15} />本地数据与备份 <small>{contentVersion}</small></summary><div><button onClick={onImport}><Upload size={15} />导入体系</button><button onClick={() => onExport()}><Download size={15} />导出体系</button><button onClick={onDuplicate}><Copy size={15} />复制当前</button><button onClick={onBackup}><Archive size={15} />完整备份</button><button onClick={onRestore}><PackageOpen size={15} />恢复备份</button><button onClick={onDataUpdate} disabled={!desktopBridge.isDesktop()}><HardDrive size={15} />更新本地数据</button><button className="danger-link" onClick={onDelete}><Trash2 size={15} />删除当前</button></div></details>
    </div>
    {editingSystem && <SystemEditModal system={editingSystem} onClose={() => setEditingSystemId(null)} onSave={onRename} />}
    {creating && <SystemCreateModal onClose={() => setCreating(false)} onCreate={onCreate} onImport={onImportCode} />}
  </section>;
}

function WorkspaceApp({ catalog, onCatalogChange }: { catalog: Catalog; onCatalogChange: (catalog: Catalog) => void }) {
  const workspace = useWorkspace(catalog);
  const classes = catalog.classes;
  const champions = useMemo(() => catalogChampions(catalog), [catalog]);
  const [tab, setTab] = useState<Tab>("heroes");
  const [sortMode, setSortMode] = useState<SortMode>("class");
  const [editingHero, setEditingHero] = useState<Hero | null>(null);
  const [editingChampion, setEditingChampion] = useState<Champion | null>(null);
  const [templates, setTemplates] = useState<BuildTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showClassPicker, setShowClassPicker] = useState(false);
  const [toast, setToast] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const jumpTo = (next: Tab, id: string) => {
    setTab(next);
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth", block: "start" }), 0);
  };

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (workspace.dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard);
  }, [workspace.dirty]);

  useEffect(() => {
    void desktopBridge.listTemplates().then(setTemplates).catch((error) => setToast(error instanceof Error ? error.message : "模板加载失败"));
  }, []);

  const heroes = useMemo(() => [...(workspace.active?.heroes ?? [])].sort((a, b) => sortMode === "element"
    ? elements.indexOf(a.element) - elements.indexOf(b.element)
    : classes.findIndex((entry) => entry.id === a.classId) - classes.findIndex((entry) => entry.id === b.classId)), [classes, sortMode, workspace.active?.heroes]);

  const selectSystem = (id: string) => {
    if (id === workspace.activeId) return true;
    if (workspace.dirty && !window.confirm("当前体系有未保存修改，仍要切换吗？")) return false;
    workspace.setActiveId(id); workspace.setDirty(false);
    return true;
  };

  const exportCurrent = async (selectedSystem = workspace.active) => {
    if (!selectedSystem) return;
    const payload = await desktopBridge.exportSystems([selectedSystem]);
    if (desktopBridge.isDesktop()) {
      if (await desktopBridge.saveInterchange(payload, selectedSystem.name, "zyslineup")) setToast("体系已导出为跨平台文件");
      return;
    }
    const blob = new Blob([payload], { type: "application/json" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${selectedSystem.name}.zyslineup`; link.click(); URL.revokeObjectURL(link.href);
    setToast("体系已导出为跨平台文件");
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      const imported = await desktopBridge.importSystems(await file.text(), catalog.gameDataVersion);
      workspace.setSystems((current) => [...current, ...imported]);
      workspace.setActiveId(imported[0]?.id ?? workspace.activeId); workspace.setDirty(false); setToast(`已导入并保存 ${imported.length} 个体系`);
    } catch (error) { setToast(error instanceof Error ? error.message : "导入失败"); }
  };

  const importFromDialog = async () => {
    try {
      const payload = await desktopBridge.openInterchange("zyslineup");
      if (!payload) return;
      const imported = await desktopBridge.importSystems(payload, catalog.gameDataVersion);
      workspace.setSystems((current) => [...current, ...imported]); workspace.setActiveId(imported[0]?.id ?? workspace.activeId);
      workspace.setDirty(false); setToast(`已导入并保存 ${imported.length} 个体系`);
    } catch (error) { setToast(error instanceof Error ? error.message : "导入失败"); }
  };

  const exportBackup = async () => {
    try {
      const payload = await desktopBridge.exportBackup(catalog.gameDataVersion);
      if (await desktopBridge.saveInterchange(payload, `英雄体系完整备份-${new Date().toISOString().slice(0, 10)}`, "zysbackup")) setToast("完整备份已写入本机");
    } catch (error) { setToast(error instanceof Error ? error.message : "备份失败"); }
  };

  const restoreBackup = async () => {
    try {
      const payload = await desktopBridge.openInterchange("zysbackup");
      if (!payload || !window.confirm("恢复会替换当前全部体系、模板和设置。确定继续吗？")) return;
      const systems = await desktopBridge.restoreBackup(payload, catalog.gameDataVersion, true);
      workspace.setSystems(systems); workspace.setActiveId(systems[0]?.id ?? ""); workspace.setDirty(false); setToast("完整备份已事务恢复");
    } catch (error) { setToast(error instanceof Error ? error.message : "恢复失败"); }
  };

  const copySystemConfig = async () => {
    if (!workspace.active) return;
    try { await writeClipboard(encodeClipboard("system", workspace.active)); setToast("当前体系配置已复制到剪贴板"); }
    catch (error) { setToast(error instanceof Error ? error.message : "复制失败"); }
  };

  const pasteSystemConfig = async () => {
    if (!workspace.active) return;
    try {
      const text = await readClipboard();
      if (!text) return;
      const imported = decodeClipboard(text, "system");
      if (imported.gameDataVersion !== catalog.gameDataVersion) throw new Error(`数据版本不兼容：${imported.gameDataVersion}`);
      if (!window.confirm(`用“${imported.name}”的配置替换当前体系？当前未保存修改会被覆盖。`)) return;
      workspace.replaceActive(imported);
      setToast("体系配置已校验并载入，请保存后持久化");
    } catch (error) { setToast(error instanceof Error ? error.message : "粘贴导入失败"); }
  };

  const importSystemCode = (code: string): string | undefined => {
    try {
      const imported = decodeClipboard(code, "system");
      if (imported.gameDataVersion !== catalog.gameDataVersion) throw new Error(`数据版本不兼容：${imported.gameDataVersion}`);
      workspace.importSystem(imported);
      setToast(`已导入体系“${imported.name}”，请保存后持久化`);
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : "体系配置码无效";
    }
  };

  const exportCurrentPng = async () => {
    if (!workspace.active) return;
    try { await exportLineupPng(workspace.active, workspace.units); setToast("阵容已导出为 PNG 图片"); }
    catch (error) { setToast(error instanceof Error ? error.message : "PNG 导出失败"); }
  };

  const installDataPackage = async () => {
    try {
      if (workspace.dirty) {
        if (!window.confirm("当前体系有未保存修改。安装数据包前先保存当前体系吗？")) return;
        await workspace.save();
      }
      const installed = await desktopBridge.installDataPackage();
      if (!installed) return;
      const nextCatalog = await desktopBridge.loadCatalog();
      onCatalogChange(nextCatalog);
      setToast(`数据包 ${installed.content.gameDataVersion} 已安装并校验；${installed.staleSimulations} 条旧模拟记录已标记过期`);
    } catch (error) { setToast(error instanceof Error ? error.message : "数据包安装失败，原数据未改变"); }
  };

  const saveBuildTemplate = async (name: string, classId: string | undefined, kind: BuildTemplate["build"]["kind"], payload: Hero | ChampionLoadout) => {
    const template = await desktopBridge.saveTemplate({
      id: crypto.randomUUID(), name, classId, build: { kind, payload: structuredClone(payload) }, updatedAt: new Date().toISOString(),
    });
    setTemplates((current) => [...current.filter((entry) => entry.id !== template.id), template]);
  };

  const deleteBuildTemplate = async (id: string) => {
    await desktopBridge.deleteTemplate(id);
    setTemplates((current) => current.filter((template) => template.id !== id));
  };

  if (workspace.loading || !workspace.active) return <main className="loading-screen"><div className="loader" /><span>正在加载本地数据…</span></main>;

  return <div className="app-shell online-shell">
    <input ref={fileInput} hidden type="file" accept=".zyslineup,application/json" onChange={(event) => void importFile(event.target.files?.[0])} />
    <header className="offline-site-header"><div className="offline-site-inner"><div className="online-brand"><span><Sword size={20} /></span><strong>传奇智游社</strong><small>完全离线版</small></div><nav><button className={tab === "champions" ? "active" : ""} onClick={() => jumpTo("champions", "champions-section")}>勇士阵容</button><button className={tab === "heroes" ? "active" : ""} onClick={() => jumpTo("heroes", "heroes-section")}>英雄阵容</button><button className={tab === "adventures" ? "active" : ""} onClick={() => jumpTo("adventures", "adventures-section")}>冒险任务</button><button onClick={() => setShowTemplates(true)}>配装模板</button></nav><div className="site-header-actions"><button aria-label="粘贴配置" className="zys-button blue" onClick={() => void pasteSystemConfig()}>导入口令</button><button aria-label="复制配置" className="zys-button violet" onClick={() => void copySystemConfig()}>导出口令</button><button className="zys-button green" onClick={() => document.getElementById("system-manager-title")?.scrollIntoView?.({ behavior: "smooth" })}>本地管理</button></div></div></header>
    <main className="workspace">
      <div className="tool-container"><section className="tool-hero"><h1>英雄体系搭配平台</h1><div className="offline-warning"><HardDrive size={17} />当前为完全离线版，所有体系、配装、模拟记录和图片均保存在本机；数据版本 {catalog.gameDataVersion}</div></section>
        <SystemSidebar systems={workspace.systems} activeId={workspace.activeId} dirty={workspace.dirty} contentVersion={catalog.gameDataVersion} onSelect={selectSystem} onCreate={(name, description, localPublic) => workspace.createSystem({ name, description, localPublic })} onImportCode={importSystemCode} onUseCollection={(system) => { const imported = workspace.importSystem(system); setToast(`已从本地收藏导入“${imported.name}”，请保存后持久化`); }} onDuplicate={workspace.duplicateSystem} onDelete={() => { if (window.confirm("确定删除当前体系吗？")) void workspace.deleteActive(); }} onSave={() => void workspace.save().then(() => setToast("所有更改已保存在本机"))} onImport={() => { if (desktopBridge.isDesktop()) void importFromDialog(); else fileInput.current?.click(); }} onExport={(system) => void exportCurrent(system)} onBackup={() => void exportBackup()} onRestore={() => void restoreBackup()} onDataUpdate={() => void installDataPackage()} onRename={(name, description, localPublic) => workspace.updateActive((system) => ({ ...system, name, description, localPublic }))} />
      <div className="content online-content">
        <section id="champions-section" className="flow-section"><section className="section-heading"><div><h2>勇士阵容</h2><p>点击勇士图标进行配装，可拖动到下方任务卡片中组队冒险</p></div><button className="zys-button blue" onClick={() => setShowTemplates(true)}><BarChart3 size={16} />装备统计</button></section><div className="champion-grid">{champions.map((unit) => { const loadout = workspace.active!.championLoadouts?.[unit.id]; return <ChampionCard key={unit.id} unit={{ ...unit, ...(loadout ?? {}), stats: loadout?.stats ?? unit.stats }} onEdit={() => setEditingChampion(unit)} />; })}</div></section>
        <section id="heroes-section" className="flow-section"><section className="section-heading"><div><h2>英雄阵容 ({workspace.active.heroes.length}/41)</h2><p>点击英雄图标进行配装，可拖动到下方任务卡片中组队冒险</p></div><div className="toolbar"><button className="zys-button blue" onClick={() => setShowTemplates(true)}>装备统计</button><button className="zys-button violet" onClick={() => void exportCurrentPng()}>导出阵容</button><button className="zys-button green" disabled={workspace.active.heroes.length >= 41} onClick={() => setShowClassPicker(true)}>添加英雄</button><button className={`manager-tab ${sortMode === "class" ? "active" : ""}`} onClick={() => setSortMode("class")}>职业排序</button><button className={`manager-tab ${sortMode === "element" ? "active" : ""}`} onClick={() => setSortMode("element")}>元素排序</button></div></section><div className="hero-list">{heroes.map((hero) => <HeroCard key={hero.id} hero={hero} onEdit={() => setEditingHero(hero)} onCopy={() => workspace.duplicateHero(hero)} onDelete={() => workspace.deleteHero(hero.id)} />)}{!heroes.length && <div className="empty-state"><Users size={30} /><h3>还没有英雄</h3><p>点击“添加英雄”选择职业。</p></div>}</div></section>
        <section id="adventures-section" className="flow-section"><section className="section-heading"><div><h2>冒险任务 ({workspace.active.taskGroups.reduce((sum, group) => sum + group.tasks.length, 0)}/48)</h2><p>点击冒险任务卡片左上角冒险图标可以切换地图，拖动冒险任务卡片切换分组</p></div><button className="primary-button" disabled={workspace.active.taskGroups.reduce((sum, group) => sum + group.tasks.length, 0) >= 48} onClick={workspace.addGroup}><Plus size={16} />添加分组</button></section>{workspace.active.taskGroups.map((group) => <AdventureGroup key={group.id} systemId={workspace.active!.id} systemGameVersion={catalog.gameDataVersion} group={group} units={workspace.units} quests={catalog.quests} canAddTask={workspace.active!.taskGroups.reduce((sum, entry) => sum + entry.tasks.length, 0) < 48} onUpdate={workspace.updateGroup} onMove={(direction) => workspace.moveGroup(group.id, direction)} onDeleteGroup={() => { if (window.confirm(`确定删除任务分组“${group.name}”及其中 ${group.tasks.length} 个任务吗？`)) workspace.deleteGroup(group.id); }} onAddTask={() => workspace.addTask(group.id)} onDrop={(taskId, unitId) => workspace.dropUnit(group.id, taskId, unitId)} onMoveTask={(sourceGroupId, taskId, targetIndex) => workspace.moveTask(sourceGroupId, taskId, group.id, targetIndex)} onRemove={(taskId, unitId) => workspace.removeUnit(group.id, taskId, unitId)} onCopyTask={(task) => workspace.duplicateTask(group.id, task)} onDeleteTask={(taskId) => workspace.deleteTask(group.id, taskId)} onResult={workspace.setTaskResult} onTaskChange={(task) => workspace.updateTask(group.id, task)} />)}{!workspace.active.taskGroups.length && <div className="empty-state"><BarChart3 size={30} /><h3>还没有任务分组</h3><button className="primary-button" onClick={workspace.addGroup}><Plus size={16} />创建第一个分组</button></div>}</section>
      </div></div>
    </main>
    {editingHero && <EquipmentModal key={editingHero.id} hero={editingHero} catalog={catalog} templates={templates} onClose={() => setEditingHero(null)} onPrevious={() => {
      const heroList = workspace.active!.heroes;
      const currentIndex = heroList.findIndex((hero) => hero.id === editingHero.id);
      if (heroList.length) setEditingHero(heroList[(currentIndex - 1 + heroList.length) % heroList.length]!);
    }} onNext={() => {
      const heroList = workspace.active!.heroes;
      const currentIndex = heroList.findIndex((hero) => hero.id === editingHero.id);
      if (heroList.length) setEditingHero(heroList[(currentIndex + 1) % heroList.length]!);
    }} onClone={(hero) => {
      const clone = workspace.duplicateHero(hero);
      if (clone) setEditingHero(clone);
    }} onSave={(hero) => {
      workspace.updateHero(hero);
    }} onSaveTemplate={(name, hero) => saveBuildTemplate(name, hero.classId, "hero", hero)} />}
    {editingChampion && <ChampionEquipmentModal key={editingChampion.id} champion={editingChampion} catalog={catalog} loadout={workspace.active.championLoadouts?.[editingChampion.id]} templates={templates} onClose={() => setEditingChampion(null)} onPrevious={() => {
      const currentIndex = champions.findIndex((champion) => champion.id === editingChampion.id);
      if (champions.length) setEditingChampion(champions[(currentIndex - 1 + champions.length) % champions.length]!);
    }} onNext={() => {
      const currentIndex = champions.findIndex((champion) => champion.id === editingChampion.id);
      if (champions.length) setEditingChampion(champions[(currentIndex + 1) % champions.length]!);
    }} onSave={(loadout) => {
      workspace.updateChampionLoadout(editingChampion.id, loadout);
    }} onSaveTemplate={(name, loadout) => saveBuildTemplate(name, `champion:${editingChampion.id}`, "champion-loadout", loadout)} />}
    {showTemplates && <TemplateManager templates={templates} onDelete={deleteBuildTemplate} onClose={() => setShowTemplates(false)} />}
    {showClassPicker && <ClassPickerModal catalog={catalog} heroIndex={workspace.active.heroes.length + 1} onClose={() => setShowClassPicker(false)} onChoose={(hero) => { workspace.addHero(hero.classId, hero); setShowClassPicker(false); }} />}
    {toast && <button className="toast" onClick={() => setToast("")}><Check size={16} />{toast}<X size={14} /></button>}
  </div>;
}

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState("");
  useEffect(() => {
    void desktopBridge.loadCatalog().then(setCatalog).catch((error) => setCatalogError(error instanceof Error ? error.message : String(error)));
  }, []);
  if (catalogError) return <main className="loading-screen"><PackageOpen size={24} /><span>本地数据加载失败：{catalogError}</span></main>;
  if (!catalog) return <main className="loading-screen"><div className="loader" /><span>正在校验并加载完整本地目录…</span></main>;
  return <WorkspaceApp catalog={catalog} onCatalogChange={setCatalog} />;
}
