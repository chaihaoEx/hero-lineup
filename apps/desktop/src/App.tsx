import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive, BarChart3, Check, Clipboard, Copy, Download,
  GripVertical, HardDrive, PackageOpen, PauseCircle, Plus, ShieldCheck,
  Sword, Trash2, Upload, Users, X,
} from "lucide-react";
import { applyEquipmentFieldToAll, catalogChampions, championElementValue, elements, itemsForSlot, makeHero, normalizeHeroEquipmentSlots, skillsForSlot, type Catalog, type CatalogItem, type CatalogQuest, type CatalogSkill, type EquipmentApplyField } from "./data/catalog";
import { previewEquipmentStats, type EquipmentPreviewConfig } from "./data/equipmentPreview";
import { encodeOnlineChampionConfig, importOnlineChampionConfig } from "./data/championConfig";
import { decodeOnlineHeroTemplate, encodeOnlineHeroConfig, heroTemplateSnapshotDate, importOnlineHeroConfig, makeHeroFromOnlineTemplate, templatesForClass } from "./data/heroCreationTemplates";
import { desktopBridge } from "./platform/bridge";
import { useWorkspace } from "./state/useWorkspace";
import type { AdventureTask, BuildTemplate, CalculatedSheet, Champion, ChampionEquipmentConfig, ChampionLoadout, ElementType, Hero, LineupSystem, PartyUnit, Quality, SimulationProgress, TaskGroup, UnitStats } from "./types/domain";
import {
  captureElementPng, copyPng, decodeClipboard, downloadPng, encodeClipboard, exportLineupPng, readClipboard, writeClipboard,
} from "./utils/localTransfer";

type Tab = "champions" | "heroes" | "adventures";
type SortMode = "class" | "element";
const quality: Quality[] = ["普通", "优质", "高级", "史诗", "传说"];
const qualityDisplay: Record<Quality, string> = { 普通: "普通", 优质: "高级", 高级: "无暇", 史诗: "史诗", 传说: "传奇" };
const elementCode: Record<string, Hero["element"]> = { fire: "火", water: "水", earth: "土", air: "风", light: "光", dark: "暗" };
const elementToken: Record<ElementType, "fire" | "water" | "earth" | "air" | "light" | "dark"> = { 火: "fire", 水: "water", 土: "earth", 风: "air", 光: "light", 暗: "dark" };
const elementBadge: Record<ElementType, { label: string; path: string }> = {
  火: { label: "fire", path: "Sprite/icon_global_elemental_fire.png" },
  水: { label: "water", path: "Sprite/icon_global_elemental_water.png" },
  土: { label: "earth", path: "Sprite/icon_global_elemental_earth.png" },
  风: { label: "air", path: "Sprite/icon_global_elemental_air.png" },
  光: { label: "light", path: "Sprite/icon_global_elemental_light.png" },
  暗: { label: "dark", path: "Sprite/icon_global_elemental_dark.png" },
};
const equipmentTierByLevel = [1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 10, 10, 11, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15, 16];
type EquipmentPreviewContextValue = EquipmentPreviewConfig & { catalog: Catalog; element?: string | undefined; spirit?: string | undefined };
const EquipmentPreviewContext = createContext<EquipmentPreviewContextValue | undefined>(undefined);

function maxEquipmentTier(level: number) {
  return equipmentTierByLevel[Math.max(0, Math.min(39, level - 1))] ?? 16;
}

function questBarrier(quest: CatalogQuest | undefined): AdventureTask["barrier"] {
  if (!quest || quest.barrierPower <= 0) return {};
  const candidates = quest.barrierElements?.length ? quest.barrierElements : quest.barrierElement ? [quest.barrierElement] : [];
  return Object.fromEntries(candidates.map((element) => [element, quest.barrierPower])) as AdventureTask["barrier"];
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

const editorStatMeta = {
  health: ["生命", "/Sprite/icon_global_health.png"],
  attack: ["攻击", "/Sprite/icon_global_attack.png"],
  critical: ["暴击", "/Sprite/icon_global_critchance.png"],
  defense: ["防御", "/Sprite/icon_global_defense.png"],
  evasion: ["回避", "/Sprite/icon_global_evasion.png"],
  aggro: ["威胁", undefined],
  elementValue: ["元素", "/Sprite/icon_global_elemental_all.png"],
} as const;

function EditorStatRow({ statKey, sheet, fallback }: {
  statKey: keyof typeof editorStatMeta;
  sheet: CalculatedSheet | null;
  fallback: UnitStats;
}) {
  const [label, spritePath] = editorStatMeta[statKey];
  const fallbackKey = statKey === "critical" ? "crit" : statKey === "elementValue" ? "element" : statKey;
  const value = Number(sheet?.stats[statKey] ?? fallback[fallbackKey as keyof UnitStats] ?? 0);
  const display = statKey === "critical"
    ? `${value.toLocaleString()}% / ${Math.round((sheet?.stats.criticalDamage ?? ((fallback.criticalDamage ?? 200) / 100)) * 100)}%`
    : statKey === "evasion" ? `${value.toLocaleString()}%` : value.toLocaleString();
  return <div className="live-stat">
    <span>{spritePath ? <AssetImage path={spritePath} alt={label} /> : <b className="threat-stat-icon">!</b>}{label}</span>
    <strong>{display}</strong>
  </div>;
}

function ImageExportPreview({ title, dataUrl, filename, onClose, onMessage }: {
  title: string;
  dataUrl: string;
  filename: string;
  onClose: () => void;
  onMessage: (message: string) => void;
}) {
  const copy = async () => {
    try {
      await copyPng(dataUrl);
      onMessage("图片已复制到剪贴板");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "复制失败，请使用下载功能");
    }
  };
  return <div className="modal-backdrop image-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="image-preview-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2><button className="zys-button red" onClick={onClose}>关闭</button></header>
      <div className="image-preview-actions"><button className="zys-button blue" onClick={() => void copy()}>复制图片</button><button className="zys-button green" onClick={() => downloadPng(dataUrl, filename)}>下载图片</button></div>
      <div className="image-preview-canvas"><img src={dataUrl} alt={title} /></div>
    </section>
  </div>;
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
  useEffect(() => { setOpen(false); }, [value]);
  return <div className="choice-picker">
    <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>{format(value)}</button>
    {open && <div className="choice-picker-menu" role="listbox" aria-label={`${label}选项`}>
      {options.map((option) => {
        const choose = () => { setOpen(false); onChange(option); };
        return <button type="button" role="option" aria-selected={option === value} className={option === value ? "active" : ""} key={option}
          onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); choose(); }}
          onClick={(event) => { event.stopPropagation(); choose(); }}>{format(option)}</button>;
      })}
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
      {!selectedClass && <div className="class-picker-grid">{catalog.classes.map((entry) => {
        const badge = entry.allElements
          ? { label: "all", path: "Sprite/icon_global_elemental_all.png" }
          : elementBadge[entry.element];
        return <button key={entry.id} onClick={() => setSelectedClassId(entry.id)}>
          <span className="class-picker-art">
            <AssetImage path={entry.spritePath} alt={entry.name} className="class-picker-class-icon" />
            <AssetImage path={badge.path} alt={badge.label} className="class-picker-element-badge" />
          </span>
          <strong>{entry.name}</strong>
        </button>;
      })}</div>}
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

function SimulationMemberConfig({ unit, catalog, onCopy }: { unit: PartyUnit; catalog: Catalog; onCopy: () => void }) {
  const hero = unit.kind === "hero" ? unit : undefined;
  const champion = unit.kind === "champion" ? unit as Champion & Partial<ChampionLoadout> : undefined;
  const heroClass = hero ? catalog.classes.find((entry) => entry.id === hero.classId) : undefined;
  const innateSkill = heroClass?.innateSkillFamily
    ? catalog.skills.find((skill) => skill.family === heroClass.innateSkillFamily && skill.tier === 1)
    : undefined;
  const selectedSkills = hero?.skills.map((id) => catalog.skills.find((skill) => skill.id === id)).filter(Boolean) as CatalogSkill[] | undefined;
  const catalogChampion = champion ? catalog.champions.find((entry) => entry.id === champion.id) : undefined;
  const teamSkill = catalogChampion?.teamSkills.find((skill) => skill.tier === champion?.rank)
    ?? catalogChampion?.teamSkills.filter((skill) => skill.tier <= (champion?.rank ?? 1)).at(-1)
    ?? catalogChampion?.teamSkills[0];
  const equipment = hero?.equipment.map((slot) => ({
    label: slot.slot,
    config: slot,
    item: catalog.items.find((item) => item.id === slot.itemId),
  })) ?? [
    { label: "使魔", config: champion?.familiarEquipment, item: catalog.items.find((item) => item.id === champion?.familiarEquipment?.itemId || item.id === champion?.familiar) },
    { label: "光环之歌", config: champion?.auraSongEquipment, item: catalog.items.find((item) => item.id === champion?.auraSongEquipment?.itemId || item.id === champion?.aurasong) },
  ];
  return <article className="simulation-config-card">
    <header>
      <button className="simulation-config-avatar" title="复制线上兼容配置码" onClick={onCopy}><UnitAvatar unit={unit} /></button>
      <div><strong>{unit.name}</strong><small>{hero?.className ?? `勇士 · ${catalogChampion?.name ?? unit.name}`}</small></div>
    </header>
    <div className="simulation-config-skills">
      {hero ? <><div><SkillArt skill={innateSkill} innate level={innateSkill?.tier ?? 1} /><small>自带技能</small><b>{innateSkill?.name ?? "无"}</b></div>{Array.from({ length: 4 }, (_, index) => {
        const skill = selectedSkills?.[index];
        return <div key={index}><SkillArt skill={skill} level={skill?.tier ?? 1} /><small>技能 {index + 1}</small><b>{skill?.name ?? "未配置"}</b></div>;
      })}</> : <div><SkillArt skill={teamSkill} innate level={teamSkill?.tier ?? champion?.rank ?? 1} /><small>团队技能</small><b>{teamSkill?.name ?? "未配置"}</b></div>}
    </div>
    <dl className="simulation-config-meta">
      <div><dt>等级</dt><dd>{unit.level}</dd></div>
      <div><dt>{hero ? "种子" : "Rank"}</dt><dd>{hero?.seed ?? champion?.rank ?? 1}</dd></div>
      <div><dt>卡片等级</dt><dd>{unit.cardLevel}</dd></div>
    </dl>
    <div className="simulation-config-stats">
      <span>♥ 生命 <b>{unit.stats.health.toLocaleString()}</b></span>
      <span>⚔ 攻击 <b>{unit.stats.attack.toLocaleString()}</b></span>
      <span>◆ 防御 <b>{unit.stats.defense.toLocaleString()}</b></span>
      <span>✹ 暴击 <b>{unit.stats.crit}% / {unit.stats.criticalDamage ?? 200}%</b></span>
      <span>➟ 回避 <b>{unit.stats.evasion}%</b></span>
      <span>⚠ 威胁 <b>{unit.stats.aggro ?? 0}</b></span>
      <span>✦ 元素 <b>{unit.stats.element ?? 0}</b></span>
    </div>
    <div className={`simulation-config-equipment ${hero ? "" : "champion"}`}>{equipment.map(({ label, config, item }) => <div key={label}>
      <span className="simulation-equipment-art">{item ? <AssetImage path={item.spritePath} alt={item.name} /> : label.slice(0, 1)}</span>
      <strong>{item?.name ?? config?.name ?? label}</strong>
      <small>{item ? `T${item.tier} · ${qualityDisplay[config?.quality ?? "普通"]}` : "未装备"}</small>
    </div>)}</div>
  </article>;
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
  const [pickerConfig, setPickerConfig] = useState<EquipmentPreviewConfig>({ quality: "普通", shiny: false, transcendence: 0 });
  const [skillPickerIndex, setSkillPickerIndex] = useState<number | null>(null);
  const [sheet, setSheet] = useState<CalculatedSheet | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [exportingImage, setExportingImage] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const exportSurfaceRef = useRef<HTMLDivElement>(null);
  const initialDraftRef = useRef(JSON.stringify(draft));
  const onSaveRef = useRef(onSave);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  const heroTemplates = templates.filter((template) => template.build.kind === "hero" && (!template.classId || template.classId === hero.classId));
  const heroClass = catalog.classes.find((entry) => entry.id === draft.classId);
  const innateSkill = catalog.skills.find((skill) => skill.family === heroClass?.innateSkillFamily && skill.tier === 1);
  const currentSkill = (family: string | undefined) => {
    if (!family) return undefined;
    const elementValue = sheet?.stats.elementValue ?? 0;
    return catalog.skills.filter((skill) => skill.family === family && skill.tier <= (heroClass?.maxSkillLevel ?? 3) && skill.elements <= elementValue)
      .sort((left, right) => right.tier - left.tier)[0]
      ?? catalog.skills.find((skill) => skill.family === family && skill.tier === 1);
  };
  const currentInnateSkill = currentSkill(heroClass?.innateSkillFamily) ?? innateSkill;
  const slot = draft.equipment[selectedSlot]!;
  const slotItem = catalog.items.find((candidate) => candidate.id === slot.itemId);
  const selectedElementId = slotItem?.builtInElementId ?? slot.element;
  const selectedSpiritId = slotItem?.builtInSpiritId ?? slot.spirit;
  const slotItems = useMemo(() => itemsForSlot(catalog, hero.classId, selectedSlot).filter((item) => item.tier <= maxEquipmentTier(draft.level))
    .sort((left, right) => right.tier - left.tier || (right.level ?? 0) - (left.level ?? 0) || (left.sourceOrder ?? 0) - (right.sourceOrder ?? 0)), [catalog, draft.level, hero.classId, selectedSlot]);
  const elementItems = useMemo(() => catalog.items.filter((item) => item.itemType === "z" && Boolean(item.elements))
    .sort((left, right) => right.tier - left.tier || left.name.localeCompare(right.name)), [catalog]);
  const spiritItems = useMemo(() => catalog.items.filter((item) => item.itemType === "z" && Boolean(item.skill))
    .sort((left, right) => right.tier - left.tier || left.name.localeCompare(right.name)), [catalog]);
  useEffect(() => {
    let active = true;
    setCalculating(true);
    void desktopBridge.calculateHero(draft).then(async (next) => {
        if (active) setSheet(next);
        if (JSON.stringify(draft) !== initialDraftRef.current) {
          const synced = { ...draft, stats: { attack: next.stats.attack, defense: next.stats.defense, health: next.stats.health, evasion: next.stats.evasion, crit: next.stats.critical, element: next.stats.elementValue, aggro: next.stats.aggro, criticalDamage: next.stats.criticalDamage * 100 } };
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
    const equipment = [...draft.equipment];
    equipment[selectedSlot] = { ...equipment[selectedSlot]!, ...patch };
    setDraft({ ...draft, equipment });
  };
  const updatePickerConfig = (patch: Partial<EquipmentPreviewConfig>) => {
    setPickerConfig({ ...pickerConfig, ...patch });
    if (slot.itemId) updateSlot(patch);
  };
  const applySlotFieldToAll = (field: EquipmentApplyField) => {
    const source = { ...slot, ...pickerConfig };
    setDraft({ ...draft, equipment: applyEquipmentFieldToAll(draft.equipment, catalog, source, field) });
  };
  const openEquipmentPicker = (index: number) => {
    const selected = draft.equipment[index]!;
    setSelectedSlot(index);
    if (selected.itemId) setPickerConfig({ quality: selected.quality, shiny: selected.shiny, transcendence: selected.transcendence });
    setPickerOpen(true);
  };
  const closeEquipmentPicker = () => setPickerOpen(false);
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
  const exportImage = async () => {
    if (!exportSurfaceRef.current) return;
    setExportingImage(true);
    try {
      setImagePreview(await captureElementPng(exportSurfaceRef.current));
    } catch (error) {
      setTransferStatus(error instanceof Error ? error.message : "图片导出失败");
    } finally {
      setExportingImage(false);
    }
  };
  return <EquipmentPreviewContext.Provider value={{ ...slot, ...pickerConfig, catalog }}><div className="modal-backdrop equipment-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <button className="equipment-hero-nav previous" aria-label="上一个英雄" onClick={onPrevious}>‹</button>
    <section className="modal equipment-modal equipment-studio" role="dialog" aria-modal="true" aria-labelledby="equipment-title">
      <header className="modal-header">
        <div><h2 id="equipment-title">英雄配装模拟 - {draft.className}</h2></div>
        <div className="modal-header-actions"><button className="zys-button blue" onClick={() => void pasteLoadout()}>导入</button><input className="modal-import-code" aria-label="粘贴配置码" placeholder="粘贴配置码" value={importText} onChange={(event) => setImportText(event.target.value)} /><button className="zys-button violet" onClick={() => void copyLoadout()}>导出</button><button className="zys-button green" onClick={() => onClone(draft)}>克隆</button><button className="zys-button violet" disabled={exportingImage} onClick={() => void exportImage()}>{exportingImage ? "导出中..." : "导出图片"}</button><button className="zys-button red" onClick={onClose}>关闭</button></div>
      </header>
      <div ref={exportSurfaceRef} className="editor-export-surface">
      <div className="hero-parameter-bar">
        <div className="hero-identity"><UnitAvatar unit={draft} /><div className="hero-name-editor">{editingName ? <input aria-label="英雄名称" autoFocus value={heroNameDraft} onChange={(event) => setHeroNameDraft(event.target.value)} onBlur={() => { const name = clampOnlineHeroName(heroNameDraft) || draft.name; setHeroNameDraft(name); setDraft({ ...draft, name }); setEditingName(false); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setHeroNameDraft(draft.name); setEditingName(false); } }} /> : <button type="button" title="点击改名" onClick={() => { setHeroNameDraft(draft.name); setEditingName(true); }}>{draft.name}</button>}</div></div>
        <label>英雄等级：<ChoicePicker key={`hero-level-${draft.level}`} label="英雄等级" value={draft.level} options={Array.from({ length: 50 }, (_, index) => index + 1)} onChange={(level) => setDraft({ ...draft, level })} /></label>
        <label>最大装备阶数：<strong className="parameter-readonly">{maxEquipmentTier(draft.level)}</strong></label>
        <label>种子数量：<ChoicePicker key={`hero-seed-${draft.seed}`} label="种子数量" value={draft.seed} options={Array.from({ length: 81 }, (_, index) => index)} onChange={(seed) => setDraft({ ...draft, seed })} /></label>
        <label>收藏卡牌：<ChoicePicker key={`hero-card-${draft.cardLevel}`} label="收藏卡牌" value={draft.cardLevel} options={[0, 1, 2, 3]} onChange={(cardLevel) => setDraft({ ...draft, cardLevel })} /></label>
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
        <div className="innate-effect"><div>{(currentInnateSkill?.innateEffects?.length ? currentInnateSkill.innateEffects : currentInnateSkill?.effects.length ? currentInnateSkill.effects : ["无效果"]).map((effect) => <strong key={effect}>{effect}</strong>)}</div></div>
      </section>
      {skillPickerIndex !== null && <div className="nested-picker-backdrop skill-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSkillPickerIndex(null); }}>
        <section className="skill-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="skill-picker-title">
          <header><h3 id="skill-picker-title">选择技能</h3><div><button className="zys-button red" onClick={() => setSkillPickerIndex(null)}>关闭</button></div></header>
          <div className="skill-picker-grid">
            {skillsForSlot(catalog, draft.classId, draft.skills, skillPickerIndex).map((skill) => {
              const resolvedSkill = currentSkill(skill.family) ?? skill;
              const maxSkill = catalog.skills.filter((candidate) => candidate.family === skill.family).sort((left, right) => right.tier - left.tier)[0] ?? skill;
              return <button key={skill.family} aria-label={`选择技能 ${skill.name}`} className={`skill-catalog-card rarity-${skill.rarity}`} onClick={() => {
                const skills = [...draft.skills];
                while (skills.length <= skillPickerIndex) skills.push("");
                skills[skillPickerIndex] = skill.id;
                setDraft({ ...draft, skills });
                setSkillPickerIndex(null);
              }}>
                <SkillArt skill={skill} level={resolvedSkill.tier} />
                <strong>{skill.name}</strong>
                <div>{resolvedSkill.effects.slice(0, 2).map((effect) => <span key={effect}>• {effect}</span>)}</div>
                {resolvedSkill.tier < 4 && <><small>满级技能效果</small>
                <div className="max-effects">{maxSkill.effects.slice(0, 2).map((effect) => <span key={effect}>• {effect}</span>)}</div></>}
              </button>;
            })}
          </div>
        </section>
      </div>}
      <div className="equipment-overview">
        <aside className="live-sheet overview-stats">
          <div className="workbench-title"><button className={`tower-preview-button ${draft.titan ? "active" : ""}`} onClick={() => setDraft({ ...draft, titan: !draft.titan })}>▣ 泰坦之塔/墓</button><small>{calculating ? "计算中…" : ""}</small></div>
          {(["health", "attack", "critical", "defense", "evasion", "aggro", "elementValue"] as const).map((statKey) => <EditorStatRow key={statKey} statKey={statKey} sheet={sheet} fallback={draft.stats} />)}
          {sheet?.issues.length ? <div className="sheet-issues">{sheet.issues.slice(0, 3).map((issue) => <small key={`${issue.code}-${issue.slot ?? ""}`}>{issue.message}</small>)}</div> : <div className="sheet-valid"><ShieldCheck size={15} />当前配装通过本地规则校验</div>}
        </aside>
        <section className="equipment-slot-stage"><div className="editor-attribution">© 2026 cq-zys.cn | CC BY-NC-ND 4.0</div><div className="equipment-slot-grid">{draft.equipment.map((entry, index) => {
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
      </div>
      {pickerOpen && <div className="nested-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEquipmentPicker(); }}>
        <section className="equipment-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="equipment-picker-title">
          <header><h3 id="equipment-picker-title">装备选择 - {selectedSlot + 1}</h3><button className="zys-button red" onClick={closeEquipmentPicker}>关闭</button></header>
          <div className="picker-filter-bar">
            <div><strong>星能铸造{slot.itemId && <button className="apply-all" onClick={() => applySlotFieldToAll("shiny")}>全部应用</button>}</strong><button className={pickerConfig.shiny ? "active" : ""} onClick={() => updatePickerConfig({ shiny: !pickerConfig.shiny })}>{pickerConfig.shiny ? "已开启" : "已关闭"}</button></div>
            <div><strong>超越{slot.itemId && <button className="apply-all" onClick={() => applySlotFieldToAll("transcendence")}>全部应用</button>}</strong><button aria-label={`${slot.slot}超越`} className={pickerConfig.transcendence > 0 ? "active" : ""} onClick={() => updatePickerConfig({ transcendence: pickerConfig.transcendence > 0 ? 0 : 1 })}>{pickerConfig.transcendence > 0 ? "已开启" : "已关闭"}</button></div>
            <div className="rarity-row"><strong>稀有度{slot.itemId && <button className="apply-all" onClick={() => applySlotFieldToAll("quality")}>全部应用</button>}</strong>{quality.map((value) => <button key={value} className={pickerConfig.quality === value ? "active" : ""} onClick={() => updatePickerConfig({ quality: value })}>{qualityDisplay[value]}</button>)}</div>
          </div>
          <div className="equipment-picker-columns">
            <section><h4>装备</h4><div className="item-grid">{slotItems.map((item) => <ItemTile key={item.id} item={item} selected={slot.itemId === item.id} onClick={() => updateSlot(slot.itemId === item.id ? { itemId: undefined, name: undefined } : { itemId: item.id, name: item.name, ...pickerConfig, ...(item.builtInElementId ? { element: undefined } : {}), ...(item.builtInSpiritId ? { spirit: undefined } : {}) })} />)}</div></section>
            <section><h4>元素附魔{selectedElementId && <button className="apply-all" onClick={() => applySlotFieldToAll("element")}>全部应用</button>}</h4><div className="enchant-catalog-grid">{elementItems.map((item) => {
              const selected = selectedElementId === item.id || enchantFamily(item) === selectedElementId;
              return <ItemTile compact key={item.id} item={item} selected={selected} onClick={() => { if (!slotItem?.builtInElementId) updateSlot({ element: selected ? undefined : item.id }); }} />;
            })}</div></section>
            <section><h4>精萃附魔{selectedSpiritId && <button className="apply-all" onClick={() => applySlotFieldToAll("spirit")}>全部应用</button>}</h4><div className="spirit-catalog-grid">{spiritItems.map((item) => {
              const selected = selectedSpiritId === item.id || selectedSpiritId === item.name;
              return <ItemTile compact key={item.id} item={item} selected={selected} onClick={() => { if (!slotItem?.builtInSpiritId) updateSlot({ spirit: selected ? undefined : item.id }); }} />;
            })}</div></section>
          </div>
        </section>
      </div>}
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
    {imagePreview && <ImageExportPreview title="英雄配装图片预览" dataUrl={imagePreview} filename={`英雄配装_${draft.className}_${Date.now()}`} onClose={() => setImagePreview(null)} onMessage={setTransferStatus} />}
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
  const [pickerConfig, setPickerConfig] = useState<EquipmentPreviewConfig>({ quality: "普通", shiny: false, transcendence: 0 });
  const [sheet, setSheet] = useState<CalculatedSheet | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [exportingImage, setExportingImage] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const exportSurfaceRef = useRef<HTMLDivElement>(null);
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
  const selectedChampionEquipment = storedChampionEquipment[picker ?? "familiar"];
  const selectedChampionItem = catalog.items.find((item) => item.id === selectedChampionEquipment.itemId);
  const selectedChampionElementId = selectedChampionItem?.builtInElementId ?? selectedChampionEquipment.element;
  const selectedChampionSpiritId = selectedChampionItem?.builtInSpiritId ?? selectedChampionEquipment.spirit;
  const updateChampionEquipment = (patch: Partial<typeof selectedChampionEquipment>) => {
    if (!picker) return;
    const equipment = { ...storedChampionEquipment, [picker]: { ...selectedChampionEquipment, ...patch } };
    setDraft({
      ...draft,
      familiar: equipment.familiar.itemId ?? "",
      aurasong: equipment.aurasong.itemId ?? "",
      familiarEquipment: equipment.familiar,
      auraSongEquipment: equipment.aurasong,
    });
  };
  const updateChampionPickerConfig = (patch: Partial<EquipmentPreviewConfig>) => {
    setPickerConfig({ ...pickerConfig, ...patch });
    if (selectedChampionEquipment.itemId) updateChampionEquipment(patch);
  };
  const openChampionPicker = (kind: "familiar" | "aurasong") => {
    const equipment = storedChampionEquipment[kind];
    if (equipment.itemId) setPickerConfig({ quality: equipment.quality, shiny: equipment.shiny, transcendence: equipment.transcendence });
    setPicker(kind);
  };
  const closeChampionPicker = () => setPicker(null);
  const applyChampionFieldToAll = (field: EquipmentApplyField) => {
    const source = { ...selectedChampionEquipment, ...pickerConfig };
    const equipment = storedChampionEquipment;
    const apply = (entry: ChampionEquipmentConfig) => {
      if (!entry.itemId) return entry;
      const item = catalog.items.find((candidate) => candidate.id === entry.itemId);
      if (field === "element" && item?.builtInElementId) return entry;
      if (field === "spirit" && item?.builtInSpiritId) return entry;
      return { ...entry, [field]: source[field] };
    };
    const next = { familiar: apply(equipment.familiar), aurasong: apply(equipment.aurasong) };
    setDraft({
      ...draft,
      familiar: next.familiar.itemId ?? "",
      aurasong: next.aurasong.itemId ?? "",
      familiarEquipment: next.familiar,
      auraSongEquipment: next.aurasong,
    });
  };
  useEffect(() => {
    let active = true;
    setCalculating(true);
    void desktopBridge.calculateChampion(champion, draft).then(async (next) => {
        if (active) setSheet(next);
        if (JSON.stringify(draft) !== initialDraftRef.current) {
          const synced = { ...draft, stats: { attack: next.stats.attack, defense: next.stats.defense, health: next.stats.health, evasion: next.stats.evasion, crit: next.stats.critical, element: next.stats.elementValue, aggro: next.stats.aggro, criticalDamage: next.stats.criticalDamage * 100 } };
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
  const exportImage = async () => {
    if (!exportSurfaceRef.current) return;
    setExportingImage(true);
    try {
      setImagePreview(await captureElementPng(exportSurfaceRef.current));
    } catch (error) {
      setTransferStatus(error instanceof Error ? error.message : "图片导出失败");
    } finally {
      setExportingImage(false);
    }
  };
  return <EquipmentPreviewContext.Provider value={{ ...selectedChampionEquipment, ...pickerConfig, catalog }}><div className="modal-backdrop equipment-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <button className="equipment-hero-nav previous" aria-label="上一个勇士" onClick={onPrevious}>‹</button>
    <section className="modal champion-modal equipment-studio" role="dialog" aria-modal="true" aria-labelledby="champion-equipment-title">
      <header className="modal-header"><div><h2 id="champion-equipment-title">勇士配装模拟 - {champion.name}</h2></div><div className="modal-header-actions"><button className="zys-button blue" onClick={() => void pasteLoadout()}>导入</button><input className="modal-import-code" aria-label="粘贴配置码" placeholder="粘贴配置码" value={importText} onChange={(event) => setImportText(event.target.value)} /><button className="zys-button violet" onClick={() => void copyLoadout()}>导出</button><button className="zys-button violet" disabled={exportingImage} onClick={() => void exportImage()}>{exportingImage ? "导出中..." : "导出图片"}</button><button className="zys-button red" onClick={onClose}>关闭</button></div></header>
      <div ref={exportSurfaceRef} className="editor-export-surface champion-export-surface">
      <div className="hero-parameter-bar champion-parameter-bar">
        <div className="hero-identity"><UnitAvatar unit={champion} /><strong>{champion.name}</strong></div>
        <label>勇士等级：<ChoicePicker key={`champion-level-${draft.level}`} label="勇士等级" value={draft.level} options={Array.from({ length: 50 }, (_, index) => index + 1)} onChange={(level) => setDraft({ ...draft, level })} /></label>
        <label>最大装备阶数：<strong className="parameter-readonly">{maxEquipmentTier(draft.level)}</strong></label>
        <label>勇士阶数：<ChoicePicker key={`champion-rank-${draft.rank}`} label="勇士阶数" value={draft.rank} options={Array.from({ length: 71 }, (_, index) => index + 1)} format={(rank) => rank <= 11 ? String(rank) : `11+${rank - 11}`} onChange={(rank) => setDraft({ ...draft, rank })} /></label>
        <label>种子数量：<ChoicePicker key={`champion-seed-${draft.seed}`} label="勇士种子数量" value={draft.seed} options={Array.from({ length: 81 }, (_, index) => index)} onChange={(seed) => setDraft({ ...draft, seed })} /></label>
        <label>收藏卡牌：<ChoicePicker key={`champion-card-${draft.cardLevel}`} label="勇士收藏卡牌" value={draft.cardLevel} options={[0, 1, 2, 3]} onChange={(cardLevel) => setDraft({ ...draft, cardLevel })} /><small>({draft.cardLevel === 0 ? 0 : draft.cardLevel === 1 ? 5 : draft.cardLevel === 2 ? 10 : 25}% 攻防血增益)</small></label>
        <label className="titan-toggle"><span>勇士之魂：</span><input aria-label="勇士之魂" type="checkbox" checked={draft.titan} onChange={(event) => setDraft({ ...draft, titan: event.target.checked })} /></label>
      </div>
      <section className="champion-team-skill" aria-label="勇士团队技能"><SkillArt skill={teamSkill} innate level={teamSkillLevel} /><div><small>固定团队技能 · 等级 {teamSkillLevel}</small><strong>{teamSkill?.name ?? catalogChampion?.teamSkillIds[teamSkillLevel - 1] ?? "团队技能"}</strong>{teamSkill?.effects.slice(0, 3).map((effect) => <span key={effect}>{effect}</span>)}</div></section>
      <div className="equipment-overview champion-overview">
        <aside className="live-sheet overview-stats"><div className="workbench-title"><button className={`tower-preview-button ${draft.titan ? "active" : ""}`} onClick={() => setDraft({ ...draft, titan: !draft.titan })}>▣ 泰坦之塔/墓</button><small>{calculating ? "计算中…" : ""}</small></div>{(["health", "attack", "critical", "defense", "evasion", "aggro", "elementValue"] as const).map((statKey) => <EditorStatRow key={statKey} statKey={statKey} sheet={sheet} fallback={draft.stats ?? champion.stats} />)}{sheet?.issues.length ? <div className="sheet-issues">{sheet.issues.slice(0, 3).map((issue) => <small key={issue.code}>{issue.message}</small>)}</div> : <div className="sheet-valid"><ShieldCheck size={15} />当前配装通过本地规则校验</div>}</aside>
        <section className="equipment-slot-stage"><div className="editor-attribution">© 2026 cq-zys.cn | CC BY-NC-ND 4.0</div><div className="champion-slot-grid">{([
          ["familiar", "使魔", draft.familiar, familiarItems], ["aurasong", "光环", draft.aurasong, auraItems],
        ] as const).map(([kind, label, value, items]) => { const config = kind === "familiar" ? draft.familiarEquipment : draft.auraSongEquipment; const itemId = config?.itemId ?? value; const item = items.find((entry) => entry.id === itemId || entry.name === itemId); return <button key={kind} aria-label={`${label}装备槽`} className={`overview-slot champion-slot quality-${config?.quality ?? "普通"}`} onClick={() => openChampionPicker(kind)}><span className="overview-slot-art">{item ? <AssetImage path={item.spritePath} alt={item.name} /> : <span>{label.slice(0, 1)}</span>}</span><strong>{item?.name ?? (itemId || label)}</strong><small>{item ? `T${item.tier} · ${qualityDisplay[config?.quality ?? "普通"]}` : "点击选择装备"}</small></button>; })}</div></section>
      </div>
      </div>
      {picker && <div className="nested-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeChampionPicker(); }}>
        <section className="equipment-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="champion-picker-title">
          <header><h3 id="champion-picker-title">装备选择 - {picker === "familiar" ? "使魔" : "光环"}</h3><button className="zys-button red" onClick={closeChampionPicker}>关闭</button></header>
          <div className="picker-filter-bar champion-full-filter">
            <div><strong>星能铸造{selectedChampionEquipment.itemId && <button className="apply-all" onClick={() => applyChampionFieldToAll("shiny")}>全部应用</button>}</strong><button className={pickerConfig.shiny ? "active" : ""} onClick={() => updateChampionPickerConfig({ shiny: !pickerConfig.shiny })}>{pickerConfig.shiny ? "已开启" : "已关闭"}</button></div>
            <div><strong>超越{selectedChampionEquipment.itemId && <button className="apply-all" onClick={() => applyChampionFieldToAll("transcendence")}>全部应用</button>}</strong><button className={pickerConfig.transcendence > 0 ? "active" : ""} onClick={() => updateChampionPickerConfig({ transcendence: pickerConfig.transcendence > 0 ? 0 : 1 })}>{pickerConfig.transcendence > 0 ? "已开启" : "已关闭"}</button></div>
            <div className="rarity-row"><strong>稀有度{selectedChampionEquipment.itemId && <button className="apply-all" onClick={() => applyChampionFieldToAll("quality")}>全部应用</button>}</strong>{quality.map((value) => <button key={value} className={pickerConfig.quality === value ? "active" : ""} onClick={() => updateChampionPickerConfig({ quality: value })}>{qualityDisplay[value]}</button>)}</div>
          </div>
          <div className="equipment-picker-columns">
            <section><h4>装备</h4><div className="item-grid">{(picker === "familiar" ? familiarItems : auraItems).map((item) => <ItemTile key={item.id} item={item} selected={selectedChampionEquipment.itemId === item.id} onClick={() => updateChampionEquipment(selectedChampionEquipment.itemId === item.id ? { itemId: undefined, name: undefined } : { itemId: item.id, name: item.name, ...pickerConfig, ...(item.builtInElementId ? { element: undefined } : {}), ...(item.builtInSpiritId ? { spirit: undefined } : {}) })} />)}</div></section>
            <section><h4>元素附魔{selectedChampionEquipment.itemId && selectedChampionElementId && <button className="apply-all" onClick={() => applyChampionFieldToAll("element")}>全部应用</button>}</h4><div className="enchant-catalog-grid">{championElementItems.map((item) => {
              const selected = selectedChampionElementId === item.id || enchantFamily(item) === selectedChampionElementId;
              return <ItemTile compact key={item.id} item={item} selected={selected} onClick={() => { if (!selectedChampionItem?.builtInElementId) updateChampionEquipment({ element: selected ? undefined : item.id }); }} />;
            })}</div></section>
            <section><h4>精萃附魔{selectedChampionSpiritId && <button className="apply-all" onClick={() => applyChampionFieldToAll("spirit")}>全部应用</button>}</h4><div className="spirit-catalog-grid">{championSpiritItems.map((item) => {
              const selected = selectedChampionSpiritId === item.id || selectedChampionSpiritId === item.name;
              return <ItemTile compact key={item.id} item={item} selected={selected} onClick={() => { if (!selectedChampionItem?.builtInSpiritId) updateChampionEquipment({ spirit: selected ? undefined : item.id }); }} />;
            })}</div></section>
          </div>
        </section>
      </div>}
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
    {imagePreview && <ImageExportPreview title="勇士配装图片预览" dataUrl={imagePreview} filename={`勇士配装_${champion.name}_${Date.now()}`} onClose={() => setImagePreview(null)} onMessage={setTransferStatus} />}
    <button className="equipment-hero-nav next" aria-label="下一个勇士" onClick={onNext}>›</button>
  </div></EquipmentPreviewContext.Provider>;
}

function QuestDifficultyArt({ quest, compact = false }: { quest: CatalogQuest; compact?: boolean }) {
  if (!quest.difficultySpritePath) return <strong>{quest.difficulty}</strong>;
  return <span className={`quest-difficulty-art${quest.difficultyBackgroundPath ? " titan" : ""}${compact ? " compact" : ""}`} aria-label={quest.difficulty}>
    {quest.difficultyBackgroundPath && <AssetImage path={quest.difficultyBackgroundPath} alt="背景" />}
    <AssetImage path={quest.difficultySpritePath} alt={compact ? "难度" : quest.difficulty} />
  </span>;
}

function QuestPickerModal({ quests, onChoose, onClose }: {
  quests: CatalogQuest[]; onChoose: (quest: CatalogQuest) => void; onClose: () => void;
}) {
  const [category, setCategory] = useState<CatalogQuest["category"]>("普通冒险");
  const [mapKey, setMapKey] = useState<string | null>(null);
  const maps = quests.filter((quest, position, all) => quest.category === category
    && all.findIndex((candidate) => candidate.category === category && candidate.mapKey === quest.mapKey) === position);
  const mapQuests = quests.filter((quest) => quest.mapKey === mapKey)
    .sort((left, right) => left.difficultyLevel - right.difficultyLevel
      || (left.variantOrder ?? 0) - (right.variantOrder ?? 0));
  return <div className="nested-picker-backdrop quest-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="quest-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="quest-picker-title">
      <header><h3 id="quest-picker-title">选择冒险任务</h3><button className="zys-button red" onClick={onClose}>关闭</button></header>
      <nav>{(["普通冒险", "黄金城", "泰坦塔", "快闪"] as const).map((entry) => <button key={entry} className={category === entry ? "active" : ""} onClick={() => { setCategory(entry); setMapKey(null); }}>{entry}</button>)}</nav>
      {mapKey ? <><div className="quest-difficulty-header"><button className="quest-picker-back" onClick={() => setMapKey(null)}>← 返回</button><div className="quest-selected-map"><AssetImage path={mapQuests[0]?.mapSpritePath ?? mapQuests[0]?.spritePath} alt={mapQuests[0]?.mapLabel ?? mapQuests[0]?.mapName ?? "地图"} /><strong>{mapQuests[0]?.mapLabel ?? mapQuests[0]?.mapName}{mapQuests[0]?.isBoss ? " (Boss)" : ""}</strong></div></div><div className={`quest-difficulty-grid${mapQuests[0]?.category === "泰坦塔" ? " titan-grid" : ""}`}>{mapQuests.map((quest) => <button key={quest.id} onClick={() => onChoose(quest)}><QuestDifficultyArt quest={quest} /><strong>{quest.difficulty}</strong></button>)}</div></> : <div className="quest-map-grid">{maps.map((quest) => <button key={quest.mapKey} onClick={() => setMapKey(quest.mapKey)}><AssetImage path={quest.mapSpritePath ?? quest.spritePath} alt={quest.mapLabel ?? quest.mapName} /><strong>{quest.mapLabel ?? `${quest.mapName}${quest.isBoss ? " (Boss)" : ""}`}</strong></button>)}</div>}
    </section>
  </div>;
}

function TaskCard({ systemId, systemGameVersion, groupId, index, task, units, quests, catalog, assignedUnitIds, canDuplicate, onDrop, onTaskDrop, onRemove, onCopy, onDelete, onResult, onChange }: {
  systemId: string; systemGameVersion: string; groupId: string; task: AdventureTask; units: PartyUnit[]; quests: CatalogQuest[]; catalog: Catalog; assignedUnitIds: string[];
  index: number; canDuplicate: boolean; onDrop: (id: string) => void; onTaskDrop: (sourceGroupId: string, taskId: string, targetIndex: number) => void;
  onRemove: (id: string) => void; onCopy: () => void; onDelete: () => void;
  onResult: (result: NonNullable<AdventureTask["result"]>) => void; onChange?: (task: AdventureTask) => void;
}) {
  const [progress, setProgress] = useState<SimulationProgress | null>(null);
  const [details, setDetails] = useState(false);
  const [message, setMessage] = useState("");
  const [memberPicker, setMemberPicker] = useState(false);
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [boosterPicker, setBoosterPicker] = useState(false);
  const [elitePicker, setElitePicker] = useState(false);
  const [barrierPicker, setBarrierPicker] = useState(false);
  const [questPicker, setQuestPicker] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const detailSurfaceRef = useRef<HTMLDivElement>(null);
  const [detailImage, setDetailImage] = useState<string | null>(null);
  const [preparingDetailImage, setPreparingDetailImage] = useState(false);
  const members = task.memberIds.map((id) => units.find((unit) => unit.id === id)).filter(Boolean) as PartyUnit[];
  const memberCandidates = units.filter((unit) => !task.memberIds.includes(unit.id) && (!onlyUnassigned || !assignedUnitIds.includes(unit.id)));
  const boosterLevel = task.config.boosterLevel ?? (task.config.booster ? 1 : 0);
  const boosterNames = ["无", "威力强化品", "超级威力强化品", "特级威力强化品"];
  const eliteKinds = [["none", "无"], ["agile", "敏捷"], ["huge", "巨大"], ["dire", "凶残"], ["wealthy", "富有"], ["epic", "传奇"]] as const;
  const eliteKind = task.config.eliteKind ?? (task.config.elite ? "epic" : "none");
  const currentQuest = quests.find((entry) => entry.id === task.questId);
  const currentQuestMapSprite = currentQuest?.mapSpritePath ?? currentQuest?.spritePath;
  const barrierOptions = [...new Set([
    ...(currentQuest?.barrierElements ?? (currentQuest?.barrierElement ? [currentQuest.barrierElement] : [])),
    ...elements.filter((element) => (task.barrier[element] ?? 0) > 0),
  ].filter((element): element is ElementType => Boolean(element)))];
  const selectedElement = task.config.selectedElement;
  const selectedElementLabel = selectedElement === "force" ? "无屏障" : selectedElement ? elementCode[selectedElement] : "自动";
  const activeBarrierElements = selectedElement === "force" ? [] : selectedElement ? [elementCode[selectedElement]!] : barrierOptions;
  const barrierPower = Math.max(0, ...activeBarrierElements.map((element) => task.barrier[element] ?? currentQuest?.barrierPower ?? 0));
  const partyElementPower = Math.floor(Math.max(0, ...activeBarrierElements.map((element) => members
    .filter((unit) => unit.element === element)
    .reduce((sum, unit) => sum + (unit.stats.element ?? 0), 0))));
  useEffect(() => {
    if (!details || !task.result) {
      setDetailImage(null);
      setPreparingDetailImage(false);
      return;
    }
    if (navigator.userAgent.includes("jsdom")) {
      setDetailImage("data:image/png;base64,iVBORw0KGgo=");
      setPreparingDetailImage(false);
      return;
    }
    let active = true;
    setDetailImage(null);
    setPreparingDetailImage(true);
    const timer = window.setTimeout(() => {
      if (!detailSurfaceRef.current) return;
      void captureElementPng(detailSurfaceRef.current)
        .then((image) => { if (active) setDetailImage(image); })
        .catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : "图片准备失败，请关闭后重试"); })
        .finally(() => { if (active) setPreparingDetailImage(false); });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [details, task.result]);
  const selectQuest = (quest: CatalogQuest) => {
    onChange?.({ ...task, questId: quest.id, name: quest.name, map: quest.mapName, difficulty: quest.difficulty,
      maxMembers: quest.maxMembers, barrier: questBarrier(quest),
      config: { ...task.config, titanTower: quest.category === "泰坦塔", selectedElement: undefined } });
    setQuestPicker(false);
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

  const exportResult = () => {
    if (!detailImage) return;
    downloadPng(detailImage, `冒险模拟详情_${task.map}_${task.difficulty}_${Date.now()}`);
    setMessage("模拟详情已导出为 PNG");
  };
  const copyResult = async () => {
    if (!detailImage) return;
    try { await copyPng(detailImage); setMessage("模拟详情图片已复制"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "图片复制失败"); }
  };
  const copyMemberConfig = async (unit: PartyUnit) => {
    try {
      if (unit.kind === "hero") await writeClipboard(encodeOnlineHeroConfig(unit));
      else {
        const champion = unit as Champion & Partial<ChampionLoadout>;
        await writeClipboard(encodeOnlineChampionConfig(champion, {
          level: champion.level, rank: champion.rank, seed: champion.seed ?? 0, cardLevel: champion.cardLevel,
          titan: champion.titan ?? false, familiar: champion.familiar ?? "", aurasong: champion.aurasong ?? "",
          familiarEquipment: champion.familiarEquipment, auraSongEquipment: champion.auraSongEquipment, stats: champion.stats,
        }));
      }
      setMessage(`${unit.name} 的线上兼容配置码已复制`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "配置码复制失败"); }
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
      <button className="quest-switcher" title="点击切换地图" aria-label={`${task.name}切换地图`} onClick={() => setQuestPicker(true)}><span className="quest-switcher-art">{currentQuestMapSprite ? <AssetImage path={currentQuestMapSprite} alt={currentQuest?.mapLabel ?? task.map} /> : "◈"}</span></button>
      <div className="online-quest-name"><GripVertical className="task-drag-handle" size={14} /><strong>{task.map}</strong>{currentQuest ? <QuestDifficultyArt quest={currentQuest} compact /> : <small>{task.difficulty}</small>}</div>
      {barrierOptions.length > 0 && selectedElement !== "force" && <span className="task-barrier-meter"><span>{barrierOptions.map((element) => <b className={`element-${element}`} key={element}>✦</b>)}</span><em className={partyElementPower >= barrierPower ? "broken" : ""}>{partyElementPower}/{barrierPower}</em></span>}
      <button className="online-card-action" aria-label="复制任务" disabled={!canDuplicate} onClick={onCopy}>克隆</button>
      <button className="online-delete-task" aria-label="删除任务" onClick={onDelete}>×</button>
    </header>
    {questPicker && <QuestPickerModal quests={quests} onChoose={selectQuest} onClose={() => setQuestPicker(false)} />}
    <div className="online-task-options">
      <div><span>强化道具</span><button aria-label={`强化道具：${boosterNames[boosterLevel]}`} className={`task-square-option booster-${boosterLevel} ${boosterLevel > 0 ? "active" : ""}`} onClick={() => { setElitePicker(false); setBarrierPicker(false); setBoosterPicker(true); }}>{boosterLevel > 0 ? <><b>♦</b><small>{boosterLevel}</small></> : "+"}</button></div>
      <div className="task-dropdown-container"><span>精英怪</span><button aria-label={`精英怪：${eliteKinds.find(([value]) => value === eliteKind)?.[1]}`} className={eliteKind !== "none" ? "active" : ""} onClick={() => { setBoosterPicker(false); setBarrierPicker(false); setElitePicker(!elitePicker); }}>{eliteKinds.find(([value]) => value === eliteKind)?.[1]}</button>{elitePicker && <div className="compact-task-dropdown" role="listbox" aria-label="精英怪类型">{eliteKinds.map(([value, label]) => <button role="option" aria-selected={eliteKind === value} key={value} className={eliteKind === value ? "active" : ""} onClick={() => { onChange?.({ ...task, config: { ...task.config, elite: value !== "none", eliteKind: value } }); setElitePicker(false); }}>{label}</button>)}</div>}</div>
      {(barrierOptions.length > 0 || selectedElement) && <div className="task-dropdown-container"><span>元素屏障</span><button aria-label={`元素屏障：${selectedElementLabel}`} className={selectedElement ? "active" : ""} onClick={() => { setBoosterPicker(false); setElitePicker(false); setBarrierPicker(!barrierPicker); }}>{selectedElementLabel}</button>{barrierPicker && <div className="compact-task-dropdown barrier-task-dropdown" role="listbox" aria-label="元素屏障选择"><button role="option" aria-selected={!selectedElement} onClick={() => { onChange?.({ ...task, config: { ...task.config, selectedElement: undefined } }); setBarrierPicker(false); }}>自动</button>{barrierOptions.map((element) => <button role="option" aria-selected={selectedElement === elementToken[element]} key={element} className={`element-${element}`} onClick={() => { onChange?.({ ...task, config: { ...task.config, selectedElement: elementToken[element] } }); setBarrierPicker(false); }}>{element}</button>)}<button role="option" aria-selected={selectedElement === "force"} onClick={() => { onChange?.({ ...task, config: { ...task.config, selectedElement: "force" } }); setBarrierPicker(false); }}>无屏障</button></div>}</div>}
      {task.config.titanTower && <label><input type="checkbox" checked onChange={(event) => onChange?.({ ...task, config: { ...task.config, titanTower: event.target.checked } })} />泰坦塔</label>}
    </div>
    {boosterPicker && <div className="nested-picker-backdrop booster-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setBoosterPicker(false); }}><section className="booster-picker-dialog" role="dialog" aria-modal="true" aria-labelledby={`booster-picker-${task.id}`}><header><h3 id={`booster-picker-${task.id}`}>冒险强化道具</h3><button className="zys-button red" onClick={() => setBoosterPicker(false)}>关闭</button></header><strong>威力强化</strong><div>{([1, 2, 3] as const).map((level) => <button key={level} className={boosterLevel === level ? "active" : ""} title={level === 1 ? "攻防 +20% · 暴击 +10%" : level === 2 ? "攻防 +40% · 暴击 +15%" : "攻防 +80% · 暴击 +30% · 暴伤 +50%"} onClick={() => { const nextLevel = boosterLevel === level ? 0 : level; onChange?.({ ...task, config: { ...task.config, booster: nextLevel > 0, boosterLevel: nextLevel } }); setBoosterPicker(false); }}><b className={`booster-gem booster-gem-${level}`}>♦</b><span>{boosterNames[level]}</span></button>)}</div></section></div>}
    <div className="party-dropzone online-party-dropzone">
      {members.map((unit) => <button className="party-member online-party-member" key={unit.id} title={`移除 ${unit.name}`} onClick={() => onRemove(unit.id)}><span className="member-avatar-wrap"><UnitAvatar unit={unit} small /><b className={`member-element element-${unit.element}`}>{unit.element}</b><i>×</i></span><span>{unit.name}</span></button>)}
      {members.length < task.maxMembers && <button className="add-party-member online-add-member" aria-label="添加成员" onClick={() => setMemberPicker(true)}><Plus size={20} /><span>添加成员</span></button>}
    </div>
    {memberPicker && <div className="nested-picker-backdrop member-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setMemberPicker(false); }}><section className="member-picker-dialog" role="dialog" aria-modal="true" aria-labelledby={`member-picker-${task.id}`}><header><h3 id={`member-picker-${task.id}`}>选择成员添加到任务</h3><div><span>未上阵成员</span><button role="switch" aria-label="仅未上阵成员" aria-checked={onlyUnassigned} className={onlyUnassigned ? "active" : ""} onClick={() => setOnlyUnassigned(!onlyUnassigned)}><i /></button><button className="zys-button red" onClick={() => setMemberPicker(false)}>关闭</button></div></header><div className="member-picker-grid">{memberCandidates.map((unit) => <button key={unit.id} onClick={() => { onDrop(unit.id); setMemberPicker(false); }}><span className="member-picker-avatar"><UnitAvatar unit={unit} small /><b className={`member-element element-${unit.element}`}>{unit.element}</b></span><strong>{unit.name}</strong><small>{unit.kind === "champion" ? "勇士" : unit.className}</small></button>)}</div></section></div>}
    {message && <div className="task-message" role="status">{message}</div>}
    {progress && progress.phase !== "complete" ? <div className="progress-area online-progress">
      <div className="progress-copy"><span>模拟中 {Math.round(progress.completed / progress.total * 100)}%</span><button className="link-button" onClick={() => controller.current?.abort()}><PauseCircle size={14} />取消</button></div>
      <progress value={progress.completed} max={progress.total} />
    </div> : null}
    <div className="online-result-row">{task.result && <><span className="online-success-icon" aria-label="成功率">☺</span><strong>成功率: {task.result.successRate.toFixed(3)}%</strong><button onClick={() => setDetails(true)}>查看详情</button></>}<button className="online-test-button" onClick={() => void run()} disabled={!members.length}>测试冒险</button></div>
    {task.result?.stale && <small className="stale-result">数据版本已变化，请重新测试</small>}
    {task.result && details && <div className="modal-backdrop simulation-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetails(false); }}><section className="modal simulation-detail-modal" role="dialog" aria-modal="true" aria-labelledby={`simulation-detail-${task.id}`}><header className="modal-header"><h2 id={`simulation-detail-${task.id}`}>冒险模拟详情</h2><div className="modal-header-actions"><button aria-label="复制图片" className="zys-button blue" disabled={!detailImage || preparingDetailImage} onClick={() => void copyResult()}>{preparingDetailImage ? "准备中..." : "复制图片"}</button><button aria-label="下载图片" className="zys-button green" disabled={!detailImage || preparingDetailImage} onClick={() => void exportResult()}>{preparingDetailImage ? "准备中..." : "下载图片"}</button><button className="zys-button red" onClick={() => setDetails(false)}>关闭</button></div></header><div ref={detailSurfaceRef} className="simulation-export-surface"><div className="simulation-quest-banner"><div className="simulation-quest-title"><span className="quest-switcher-art">{currentQuestMapSprite ? <AssetImage path={currentQuestMapSprite} alt={task.map} /> : "◈"}</span><div><strong>{task.map}</strong>{currentQuest ? <QuestDifficultyArt quest={currentQuest} compact /> : <small>{task.difficulty}</small>}</div></div><dl><div><dt>冒险强化道具</dt><dd>{boosterLevel ? boosterNames[boosterLevel] : "无"}</dd></div><div><dt>精英怪</dt><dd>{eliteKinds.find(([value]) => value === eliteKind)?.[1]}</dd></div><div><dt>元素屏障</dt><dd>{selectedElementLabel}</dd></div></dl></div><div className="simulation-summary"><div><span>尝试次数</span><strong>{(task.result.iterations ?? 10000).toLocaleString()}</strong></div><div><span>成功率</span><strong>{task.result.successRate.toFixed(2)}%</strong></div><div><span>平均回合数</span><strong>{task.result.averageTurns}</strong></div><div><span>最小回合数</span><strong>{task.result.minTurns}</strong></div><div><span>最大回合数</span><strong>{task.result.maxTurns}</strong></div></div><div className="simulation-member-summary">{members.map((unit) => { const memberResult = task.result?.memberResults?.find((entry) => entry.id === unit.id); return <article key={unit.id}><UnitAvatar unit={unit} small /><strong>{unit.name}</strong><span>存活率 {(memberResult?.survivalRate ?? task.result!.survivalRate).toFixed(1)}%</span><span>伤害 {Math.round(memberResult?.averageDamage ?? task.result!.averageDamage).toLocaleString()}</span><span>剩余生命 {Math.round(memberResult?.averageRemainingHealth ?? task.result!.averageRemainingHealth).toLocaleString()}</span></article>; })}</div><div className="simulation-config-hint">✦ 点击职业图标导出配置码，在英雄体系搭配平台导入使用 ✦</div><div className="simulation-members">{members.map((unit) => <SimulationMemberConfig key={unit.id} unit={unit} catalog={catalog} onCopy={() => void copyMemberConfig(unit)} />)}</div><footer className="simulation-detail-footer">模拟器 {task.result.simulatorVersion} · 数据 {task.result.gameDataVersion}</footer></div></section></div>}
  </article>;
}

function AdventureGroup({ systemId, systemGameVersion, group, units, quests, catalog, assignedUnitIds, canAddTask, onAddTask, onDrop, onMoveTask, onRemove, onCopyTask, onDeleteTask, onResult, onTaskChange }: {
  systemId: string; systemGameVersion: string; group: TaskGroup; units: PartyUnit[]; quests: CatalogQuest[]; catalog: Catalog; assignedUnitIds: string[];
  canAddTask: boolean;
  onAddTask: (quest: CatalogQuest) => void; onDrop: (taskId: string, unitId: string) => void; onRemove: (taskId: string, unitId: string) => void;
  onMoveTask: (sourceGroupId: string, taskId: string, targetIndex: number) => void;
  onCopyTask: (task: AdventureTask) => void; onDeleteTask: (taskId: string) => void;
  onResult: (taskId: string, result: NonNullable<AdventureTask["result"]>) => void;
  onTaskChange: (task: AdventureTask) => void;
}) {
  const [addingTask, setAddingTask] = useState(false);
  return <section className="task-group">
    <div className="task-grid" onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-zys-task")) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }} onDrop={(event) => {
      const payload = event.dataTransfer.getData("application/x-zys-task");
      if (!payload) return;
      event.preventDefault();
      try {
        const source = JSON.parse(payload) as { groupId?: unknown; taskId?: unknown };
        if (typeof source.groupId === "string" && typeof source.taskId === "string") onMoveTask(source.groupId, source.taskId, group.tasks.length);
      } catch { /* TaskCard exposes malformed drag feedback when dropped on a card. */ }
    }}>{group.tasks.map((task, index) => <TaskCard key={task.id} systemId={systemId} systemGameVersion={systemGameVersion} groupId={group.id} index={index} task={task} units={units} quests={quests} catalog={catalog} assignedUnitIds={assignedUnitIds} canDuplicate={canAddTask} onDrop={(unitId) => onDrop(task.id, unitId)} onTaskDrop={onMoveTask} onRemove={(unitId) => onRemove(task.id, unitId)} onCopy={() => onCopyTask(task)} onDelete={() => onDeleteTask(task.id)} onResult={(result) => onResult(task.id, result)} onChange={onTaskChange} />)}
      <button className="empty-task online-add-task" disabled={!canAddTask} onClick={() => setAddingTask(true)}><Plus size={22} /><span>添加任务</span></button>
    </div>
    {addingTask && <QuestPickerModal quests={quests} onChoose={(quest) => { onAddTask(quest); setAddingTask(false); }} onClose={() => setAddingTask(false)} />}
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

function EquipmentNeedsModal({ kind, needs, onClose }: {
  kind: "hero" | "champion";
  needs: { item: CatalogItem; count: number }[];
  onClose: () => void;
}) {
  const title = `${kind === "hero" ? "英雄" : "勇士"}装备需求统计`;
  const storageKey = "zys.hero-lineup.owned-equipment.v1";
  const [owned, setOwned] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Record<string, number>; }
    catch { return {}; }
  });
  const updateOwned = (itemId: string, value: number) => {
    const next = { ...owned, [itemId]: Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)) };
    setOwned(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };
  return <div className="modal-backdrop equipment-needs-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal equipment-needs-modal" role="dialog" aria-modal="true" aria-labelledby="equipment-needs-title">
      <header className="modal-header"><h2 id="equipment-needs-title">{title}</h2><button className="zys-button red" onClick={onClose}>关闭</button></header>
      {needs.length ? <div className="equipment-needs-grid">{needs.map(({ item, count }) => {
        const ownedCount = owned[item.id] ?? 0;
        return <article key={item.id} className={ownedCount >= count ? "enough" : ""}>
          <div className="equipment-need-tier"><small>阶数</small><strong>{item.tier}</strong></div>
          <span className="equipment-need-type">{item.typeName}</span>
          <AssetImage path={item.spritePath} alt={item.name} className="equipment-need-art" />
          <strong title={item.name}>{item.name}</strong>
          <div className="equipment-need-counts"><span>需要：<b>{count}</b></span><label>已有：<input aria-label={`已有 ${item.name}`} type="number" min={0} step={1} value={ownedCount} onChange={(event) => updateOwned(item.id, Number(event.target.value))} /></label></div>
        </article>;
      })}</div> : <div className="equipment-needs-empty">暂无装备需求</div>}
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
      </div> : <div className="system-import-form"><textarea aria-label="粘贴体系配置码" placeholder="粘贴6位线上口令或完整离线配置码" value={code} onChange={(event) => { setCode(event.target.value); setError(""); }} /><small>完全离线模式可直接导入本应用导出的完整口令；线上 6 位口令只保存服务器索引，不包含体系数据。</small>{error && <p role="alert">{error}</p>}</div>}
      <footer><button className="system-edit-cancel" onClick={onClose}>取消</button><button className="zys-button blue" disabled={mode === "create" ? !name.trim() : !code.trim()} onClick={commit}>{mode === "create" ? "创建" : "导入体系"}</button></footer>
    </section>
  </div>;
}

function SystemExportModal({ system, onClose, onCopy }: {
  system: LineupSystem;
  onClose: () => void;
  onCopy: () => void;
}) {
  const code = encodeClipboard("system", system);
  return <div className="modal-backdrop system-edit-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="system-export-dialog" role="dialog" aria-modal="true" aria-labelledby="system-export-title">
      <h3 id="system-export-title">导出口令</h3>
      <p>复制以下完整离线口令，可以在另一台离线设备的新建体系中导入并创建相同体系：</p>
      <textarea aria-label="体系离线口令" readOnly value={code} />
      <footer><button className="zys-button gray" onClick={onClose}>关闭</button><button className="zys-button violet" onClick={onCopy}>复制口令</button></footer>
    </section>
  </div>;
}

function SystemSidebar({ systems, activeId, dirty, contentVersion, onSelect, onCreate, onDuplicate, onDelete, onSave, onImport, onExportCode, onExportFile, onBackup, onRestore, onDataUpdate, onRename, onImportCode, onUseCollection }: {
  systems: LineupSystem[]; activeId: string; dirty: boolean; onSelect: (id: string) => boolean; onCreate: (name: string, description: string, localPublic: boolean) => void;
  contentVersion: string; onDuplicate: () => void; onDelete: () => void; onSave: () => void; onImport: () => void;
  onExportCode: (system: LineupSystem) => void; onExportFile: (system?: LineupSystem) => void;
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
      <div><button className="zys-button blue" onClick={(event) => { event.stopPropagation(); if (system.id === activeId || onSelect(system.id)) setEditingSystemId(system.id); }}>编辑</button><button className="zys-button violet" onClick={(event) => { event.stopPropagation(); onExportCode(system); }}>导出口令</button></div>
    </article>)}</nav> : <section className="local-collection"><div className="collection-search"><input aria-label="搜索本地收藏" placeholder="搜索体系名称 / 描述" value={collectionSearch} onChange={(event) => setCollectionSearch(event.target.value)} /><button className="zys-button blue">搜索</button></div><div className="collection-grid">{collection.map((system) => <article key={system.id} className="collection-card"><span className="collection-source">本地</span><strong>{system.name}</strong>{system.description && <small>{system.description}</small>}<p>英雄: {system.heroes.length} <span>|</span> 任务: {system.taskGroups.reduce((sum, group) => sum + group.tasks.length, 0)}</p><button className="zys-button blue" onClick={() => { onUseCollection(system); setManagerTab("mine"); }}>使用体系</button></article>)}{!collection.length && <div className="empty-state"><Archive size={26} /><h3>没有匹配的本地收藏</h3><p>把体系设置为“公开”后会出现在这里。</p></div>}</div></section>}
      <details className="local-maintenance"><summary><HardDrive size={15} />本地数据与备份 <small>{contentVersion}</small></summary><div><button onClick={onImport}><Upload size={15} />导入体系</button><button onClick={() => onExportFile()}><Download size={15} />导出体系</button><button onClick={onDuplicate}><Copy size={15} />复制当前</button><button onClick={onBackup}><Archive size={15} />完整备份</button><button onClick={onRestore}><PackageOpen size={15} />恢复备份</button><button onClick={onDataUpdate} disabled={!desktopBridge.isDesktop()}><HardDrive size={15} />更新本地数据</button><button className="danger-link" onClick={onDelete}><Trash2 size={15} />删除当前</button></div></details>
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
  const [equipmentNeedsKind, setEquipmentNeedsKind] = useState<"hero" | "champion" | null>(null);
  const [showClassPicker, setShowClassPicker] = useState(false);
  const [exportingSystem, setExportingSystem] = useState<LineupSystem | null>(null);
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
  const equipmentNeeds = useMemo(() => {
    if (!workspace.active || !equipmentNeedsKind) return [];
    const itemIds = equipmentNeedsKind === "hero"
      ? workspace.active.heroes.flatMap((hero) => hero.equipment.map((entry) => entry.itemId).filter((itemId): itemId is string => Boolean(itemId)))
      : Object.values(workspace.active.championLoadouts ?? {}).flatMap((loadout) => [
        loadout.familiarEquipment?.itemId ?? loadout.familiar,
        loadout.auraSongEquipment?.itemId ?? loadout.aurasong,
      ].filter((itemId): itemId is string => Boolean(itemId)));
    const counts = new Map<string, number>();
    itemIds.forEach((itemId) => counts.set(itemId, (counts.get(itemId) ?? 0) + 1));
    return [...counts].map(([itemId, count]) => ({ item: catalog.items.find((item) => item.id === itemId), count }))
      .filter((entry): entry is { item: CatalogItem; count: number } => Boolean(entry.item))
      .sort((left, right) => right.item.tier - left.item.tier || left.item.typeName.localeCompare(right.item.typeName) || (left.item.sourceOrder ?? 0) - (right.item.sourceOrder ?? 0));
  }, [catalog.items, equipmentNeedsKind, workspace.active]);

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

  const copySystemConfig = async (system = workspace.active) => {
    if (!system) return;
    try { await writeClipboard(encodeClipboard("system", system)); setToast("完整离线体系口令已复制到剪贴板"); }
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
    const onlineShortCode = code.toUpperCase().match(/(?:^|\s)([A-Z0-9]{6})(?:$|\s)/)?.[1];
    if (onlineShortCode && code.trim().length < 256) {
      return `线上口令 ${onlineShortCode} 只是一条服务器索引，口令本身不包含体系数据。当前应用为完全离线模式，请先在线导入后导出完整离线口令或 .zyslineup 文件。`;
    }
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
  const assignedUnitIds = [...new Set(workspace.active.taskGroups.flatMap((group) => group.tasks.flatMap((task) => task.memberIds)))];

  return <div className="app-shell online-shell">
    <input ref={fileInput} hidden type="file" accept=".zyslineup,application/json" onChange={(event) => void importFile(event.target.files?.[0])} />
    <header className="offline-site-header"><div className="offline-site-inner"><div className="online-brand"><span><Sword size={20} /></span><strong>传奇智游社</strong><small>完全离线版</small></div><nav><button className={tab === "champions" ? "active" : ""} onClick={() => jumpTo("champions", "champions-section")}>勇士阵容</button><button className={tab === "heroes" ? "active" : ""} onClick={() => jumpTo("heroes", "heroes-section")}>英雄阵容</button><button className={tab === "adventures" ? "active" : ""} onClick={() => jumpTo("adventures", "adventures-section")}>冒险任务</button><button onClick={() => setShowTemplates(true)}>配装模板</button></nav><div className="site-header-actions"><button aria-label="粘贴配置" className="zys-button blue" onClick={() => void pasteSystemConfig()}>导入口令</button><button aria-label="复制配置" className="zys-button violet" onClick={() => { if (workspace.active) setExportingSystem(workspace.active); }}>导出口令</button><button className="zys-button green" onClick={() => document.getElementById("system-manager-title")?.scrollIntoView?.({ behavior: "smooth" })}>本地管理</button></div></div></header>
    <main className="workspace">
      <div className="tool-container"><section className="tool-hero"><h1>英雄体系搭配平台</h1><div className="offline-warning"><HardDrive size={17} />当前为完全离线版，所有体系、配装、模拟记录和图片均保存在本机；数据版本 {catalog.gameDataVersion}</div></section>
        <SystemSidebar systems={workspace.systems} activeId={workspace.activeId} dirty={workspace.dirty} contentVersion={catalog.gameDataVersion} onSelect={selectSystem} onCreate={(name, description, localPublic) => workspace.createSystem({ name, description, localPublic })} onImportCode={importSystemCode} onUseCollection={(system) => { const imported = workspace.importSystem(system); setToast(`已从本地收藏导入“${imported.name}”，请保存后持久化`); }} onDuplicate={workspace.duplicateSystem} onDelete={() => { if (window.confirm("确定删除当前体系吗？")) void workspace.deleteActive(); }} onSave={() => void workspace.save().then(() => setToast("所有更改已保存在本机"))} onImport={() => { if (desktopBridge.isDesktop()) void importFromDialog(); else fileInput.current?.click(); }} onExportCode={setExportingSystem} onExportFile={(system) => void exportCurrent(system)} onBackup={() => void exportBackup()} onRestore={() => void restoreBackup()} onDataUpdate={() => void installDataPackage()} onRename={(name, description, localPublic) => workspace.updateActive((system) => ({ ...system, name, description, localPublic }))} />
      <div className="content online-content">
        <section id="champions-section" className="flow-section"><section className="section-heading"><div><h2>勇士阵容</h2><p>点击勇士图标进行配装，可拖动到下方任务卡片中组队冒险</p></div><button className="zys-button blue" onClick={() => setEquipmentNeedsKind("champion")}><BarChart3 size={16} />装备统计</button></section><div className="champion-grid">{champions.map((unit) => { const loadout = workspace.active!.championLoadouts?.[unit.id]; return <ChampionCard key={unit.id} unit={{ ...unit, ...(loadout ?? {}), stats: { ...unit.stats, ...(loadout?.stats ?? {}), element: loadout?.stats?.element ?? championElementValue(loadout?.rank ?? unit.rank) } }} onEdit={() => setEditingChampion(unit)} />; })}</div></section>
        <section id="heroes-section" className="flow-section"><section className="section-heading"><div><h2>英雄阵容 ({workspace.active.heroes.length}/41)</h2><p>点击英雄图标进行配装，可拖动到下方任务卡片中组队冒险</p></div><div className="toolbar"><button className="zys-button blue" onClick={() => setEquipmentNeedsKind("hero")}>装备统计</button><button className="zys-button violet" onClick={() => void exportCurrentPng()}>导出阵容</button><button className="zys-button green" disabled={workspace.active.heroes.length >= 41} onClick={() => setShowClassPicker(true)}>添加英雄</button><button className={`manager-tab ${sortMode === "class" ? "active" : ""}`} onClick={() => setSortMode("class")}>职业排序</button><button className={`manager-tab ${sortMode === "element" ? "active" : ""}`} onClick={() => setSortMode("element")}>元素排序</button></div></section><div className="hero-list">{heroes.map((hero) => <HeroCard key={hero.id} hero={hero} onEdit={() => setEditingHero(hero)} onCopy={() => workspace.duplicateHero(hero)} onDelete={() => workspace.deleteHero(hero.id)} />)}{!heroes.length && <div className="empty-state"><Users size={30} /><h3>还没有英雄</h3><p>点击“添加英雄”选择职业。</p></div>}</div></section>
        <section id="adventures-section" className="flow-section"><section className="section-heading"><div><h2>冒险任务 ({workspace.active.taskGroups.reduce((sum, group) => sum + group.tasks.length, 0)}/48)</h2><p>点击冒险任务卡片左上角冒险图标可以切换地图，拖动冒险任务卡片切换分组</p></div><button className="primary-button" disabled={workspace.active.taskGroups.reduce((sum, group) => sum + group.tasks.length, 0) >= 48} onClick={workspace.addGroup}><Plus size={16} />添加分组</button></section>{workspace.active.taskGroups.map((group) => <AdventureGroup key={group.id} systemId={workspace.active!.id} systemGameVersion={catalog.gameDataVersion} group={group} units={workspace.units} quests={catalog.quests} catalog={catalog} assignedUnitIds={assignedUnitIds} canAddTask={workspace.active!.taskGroups.reduce((sum, entry) => sum + entry.tasks.length, 0) < 48} onAddTask={(quest) => workspace.addTask(group.id, quest)} onDrop={(taskId, unitId) => workspace.dropUnit(group.id, taskId, unitId)} onMoveTask={(sourceGroupId, taskId, targetIndex) => workspace.moveTask(sourceGroupId, taskId, group.id, targetIndex)} onRemove={(taskId, unitId) => workspace.removeUnit(group.id, taskId, unitId)} onCopyTask={(task) => workspace.duplicateTask(group.id, task)} onDeleteTask={(taskId) => workspace.deleteTask(group.id, taskId)} onResult={workspace.setTaskResult} onTaskChange={(task) => workspace.updateTask(group.id, task)} />)}</section>
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
    {equipmentNeedsKind && <EquipmentNeedsModal kind={equipmentNeedsKind} needs={equipmentNeeds} onClose={() => setEquipmentNeedsKind(null)} />}
    {showClassPicker && <ClassPickerModal catalog={catalog} heroIndex={workspace.active.heroes.length + 1} onClose={() => setShowClassPicker(false)} onChoose={(hero) => { workspace.addHero(hero.classId, hero); setShowClassPicker(false); }} />}
    {exportingSystem && <SystemExportModal system={exportingSystem} onClose={() => setExportingSystem(null)} onCopy={() => void copySystemConfig(exportingSystem)} />}
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
