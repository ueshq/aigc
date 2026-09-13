"use client";

import { isGeminiConfig, isGeminiTtsModel, geminiTtsVoiceOptions, normalizeGeminiTtsVoice } from "@/lib/gemini";
import { miniMaxVideoCapabilities, miniMaxRatioOptions, normalizeMiniMaxH3Duration, normalizeMiniMaxH3Resolution, normalizeMiniMaxH3Ratio } from "@/lib/minimax-video";

import { Alert, App, Button, Empty, Form, Input, Modal, Segmented, Select, Spin, Switch, type InputRef } from "antd";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ChannelModelSelectorModal } from "@/components/channel-model-selector-modal";
import { fetchImageModels } from "@/services/api/image";
import { fetchUserConfig, measureUserStorageProvider, syncUserModelConfig, syncUserStorageProvider } from "@/services/api/user-config";
import { clearStorageConfigCache as clearFileStorageCache } from "@/services/file-storage";
import { clearStorageConfigCache as clearImageStorageCache, defaultUserStorageProvider, defaultUserWebDAVStorageProvider, loadStorageConfig, loadUserS3StorageProvider, loadUserWebDAVStorageProvider, saveUserStorageProvider, saveUserWebDAVStorageProvider, type UserStorageProvider } from "@/services/image-storage";
import { audioFormatOptions, audioVoiceOptions, glmTtsFormatOptions, glmTtsVoiceOptions, isGlmTtsModel, normalizeAudioSpeedValue, normalizeGlmTtsFormat, normalizeGlmTtsSpeed, normalizeGlmTtsVoice } from "@/lib/audio-generation";
import { isMimoPresetTtsModel, isMimoTtsModel, isMimoVoiceCloneModel, isMimoVoiceDesignModel, mimoTtsFormatOptions, mimoTtsVoiceOptions } from "@/lib/mimo-tts";
import { normalizeVideoConfig } from "@/lib/video-model-capabilities";
import { modelChannelApiKeyUrls, modelChannelBaseUrlPresets, modelChannelDefaultBaseUrls, modelChannelProtocolOptions } from "@/lib/model-channel";
import { filterChannelModelsByCapability, filterModelsByCapability, normalizeLocalChannels, resolveEffectiveConfig, useConfigStore, type AiConfig, type LocalModelChannel, type ModelCapability } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    channelKey: "imageChannelId" | "videoChannelId" | "textChannelId" | "audioChannelId";
    label: string;
};
type ConfigSection = ModelCapability | "general" | "storage";
type ConfigSnapshot = { config: AiConfig; userStorage: ReturnType<typeof defaultUserStorageProvider>; userWebDAVStorage: ReturnType<typeof defaultUserWebDAVStorageProvider> };

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", channelKey: "imageChannelId", label: "生图" },
    { capability: "video", modelKey: "videoModel", channelKey: "videoChannelId", label: "视频" },
    { capability: "audio", modelKey: "audioModel", channelKey: "audioChannelId", label: "音频" },
    { capability: "text", modelKey: "textModel", channelKey: "textChannelId", label: "文本" },
];
const sectionOptions = [...modelGroups.map((group) => ({ value: group.capability, label: group.label + "模型" })), { value: "general", label: "通用偏好" }, { value: "storage", label: "存储设置" }];
const secondaryText = "text-xs text-[var(--ant-color-text-secondary)]";
const navigationItem = "w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[var(--ant-color-fill-tertiary)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ant-color-primary)]";

export function AppConfigModal() {
    const { message, modal } = App.useApp();
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const replaceConfig = useConfigStore((state) => state.replaceConfig);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const [config, setConfig] = useState(() => configWithChannels(useConfigStore.getState().config));
    const [userStorage, setUserStorage] = useState(() => defaultUserStorageProvider());
    const [userWebDAVStorage, setUserWebDAVStorage] = useState(() => defaultUserWebDAVStorageProvider());
    const [baseline, setBaseline] = useState<ConfigSnapshot | null>(null);
    const [loadingConfig, setLoadingConfig] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [reload, setReload] = useState(0);
    const [savingConfig, setSavingConfig] = useState(false);
    const [saveError, setSaveError] = useState("");
    const [section, setSection] = useState<ConfigSection>("image");
    const [selectedChannels, setSelectedChannels] = useState<Partial<Record<ConfigSection, string>>>({});
    const [candidateModels, setCandidateModels] = useState<Record<string, string>>({});
    const [modelSelectChannelId, setModelSelectChannelId] = useState("");
    const [channelError, setChannelError] = useState<{ id: string; field: "baseUrl" | "apiKey"; text: string } | null>(null);
    const [allowUserStorageProvider, setAllowUserStorageProvider] = useState(false);
    const [measuringStorageType, setMeasuringStorageType] = useState<"s3" | "webdav" | null>(null);
    const [storageUsageText, setStorageUsageText] = useState("");
    const [webDAVStorageUsageText, setWebDAVStorageUsageText] = useState("");
    const session = useRef(0);
    const saveLock = useRef(false);
    const measureLock = useRef(false);
    const selectorSession = useRef(0);
    const remoteStorageSync = useRef({ s3: false, webdav: false });
    const baseUrlInput = useRef<InputRef>(null);
    const apiKeyInput = useRef<InputRef>(null);
    const configRef = useRef(config);
    configRef.current = config;

    const modelChannel = publicSettings?.modelChannel || null;
    const isLoggedIn = Boolean(token && user);
    const canUseRemoteChannel = isLoggedIn && (user?.role === "admin" || modelChannel?.allowUserRemoteChannel === true);
    const allowCustomChannel = isLoggedIn && modelChannel?.allowCustomChannel === true;
    const modelConfig = resolveEffectiveConfig(config, modelChannel, canUseRemoteChannel);
    const effectiveMode = modelConfig.channelMode;
    const group = modelGroups.find((item) => item.capability === section);
    const localChannels = config.localChannels;
    const channels: LocalModelChannel[] = effectiveMode === "local" ? localChannels : modelConfig.publicChannels
        .filter((channel) => channel.id && channel.enabled !== false)
        .map((channel) => ({ id: channel.id!, name: channel.name || "云端渠道", protocol: channel.protocol || "openai", baseUrl: channel.baseUrl || "", apiKey: "", models: (channel.models || []).filter((model) => modelConfig.models.includes(model)) }));
    const channelsFor = (item: ModelGroup) => effectiveMode === "local" ? channels : channels.filter((channel) => modelsFor(channel, item).length);
    const defaultChannelFor = (item: ModelGroup) => {
        const available = channelsFor(item);
        return available.find((channel) => channel.id === modelConfig[item.channelKey] && modelsFor(channel, item).includes(modelConfig[item.modelKey]))
            || (effectiveMode === "remote" ? available.find((channel) => modelsFor(channel, item).includes(modelConfig[item.modelKey])) : undefined);
    };
    const availableChannels = group ? channelsFor(group) : [];
    const selectedChannel = availableChannels.find((channel) => channel.id === selectedChannels[section]) || (group ? availableChannels.find((channel) => channel.id === modelConfig[group.channelKey]) || defaultChannelFor(group) : undefined) || availableChannels[0];
    const candidateKey = `${effectiveMode}:${section}:${selectedChannel?.id || ""}`;
    const availableModels = selectedChannel && group ? modelsFor(selectedChannel, group) : [];
    const candidateModel = candidateModels[candidateKey] ?? (group && defaultChannelFor(group)?.id === selectedChannel?.id ? modelConfig[group.modelKey] : availableModels[0]) ?? "";
    const isDefault = Boolean(group && selectedChannel && config[group.channelKey] === selectedChannel.id && config[group.modelKey] === candidateModel);
    const modelSelectChannel = localChannels.find((channel) => channel.id === modelSelectChannelId);
    const audioChannel = defaultChannelFor(modelGroups[2]);
    const audioConfig = { ...modelConfig, model: modelConfig.audioModel, audioChannelId: audioChannel?.id || modelConfig.audioChannelId };
    const miniMax = defaultChannelFor(modelGroups[1])?.protocol === "minimax" ? miniMaxVideoCapabilities(modelConfig.videoModel) : null;
    const glmTts = isGlmTtsModel(modelConfig.audioModel);
    const geminiTts = isGeminiTtsModel(modelConfig.audioModel) && isGeminiConfig(audioConfig, modelConfig.audioModel);
    const dirty = Boolean(baseline && JSON.stringify({ config, userStorage, userWebDAVStorage }) !== JSON.stringify(baseline));

    useEffect(() => {
        const run = ++session.current;
        if (!isConfigOpen) return;
        let canceled = false;
        setLoadingConfig(true);
        setLoadError("");
        setSaveError("");
        setBaseline(null);
        setSection("image");
        setSelectedChannels({});
        setCandidateModels({});
        setModelSelectChannelId("");
        setChannelError(null);
        setStorageUsageText("");
        setWebDAVStorageUsageText("");
        setMeasuringStorageType(null);
        setSavingConfig(false);
        saveLock.current = false;
        measureLock.current = false;
        const initialConfig = useConfigStore.getState().config;
        const localStorage = loadUserS3StorageProvider() || defaultUserStorageProvider();
        const localWebDAVStorage = loadUserWebDAVStorageProvider() || defaultUserWebDAVStorageProvider();
        void Promise.all([
            token && user?.id ? fetchUserConfig(token) : Promise.resolve(null),
            loadStorageConfig().catch(() => null),
        ]).then(([payload, storage]) => {
            if (canceled || session.current !== run) return;
            const syncStorageConfig = payload ? payload.modelConfig?.syncStorageConfig === true : initialConfig.syncStorageConfig;
            const syncWebDAVStorageConfig = payload ? payload.modelConfig?.syncWebDAVStorageConfig === true : initialConfig.syncWebDAVStorageConfig;
            remoteStorageSync.current = { s3: syncStorageConfig, webdav: syncWebDAVStorageConfig };
            const snapshot: ConfigSnapshot = {
                config: configWithChannels({ ...initialConfig, ...payload?.modelConfig, syncStorageConfig, syncWebDAVStorageConfig }),
                userStorage: syncStorageConfig && payload?.storageProvider?.s3 ? { ...defaultUserStorageProvider(), ...payload.storageProvider.s3, type: "s3" } : localStorage,
                userWebDAVStorage: syncWebDAVStorageConfig && payload?.storageProvider?.webdav ? { ...defaultUserWebDAVStorageProvider(), ...payload.storageProvider.webdav, type: "webdav" } : localWebDAVStorage,
            };
            setConfig(snapshot.config);
            setUserStorage(snapshot.userStorage);
            setUserWebDAVStorage(snapshot.userWebDAVStorage);
            setBaseline(snapshot);
            setAllowUserStorageProvider(storage?.allowUserProvider === true);
        }).catch((error) => {
            if (!canceled && session.current === run) setLoadError(error instanceof Error ? error.message : "账号配置加载失败");
        }).finally(() => {
            if (!canceled && session.current === run) setLoadingConfig(false);
        });
        return () => {
            canceled = true;
            session.current++;
            selectorSession.current++;
        };
    }, [isConfigOpen, token, user?.id, reload]);

    const isCurrentSession = (run: number) => session.current === run && useConfigStore.getState().isConfigOpen && useUserStore.getState().token === token;
    const updateConfig = <K extends keyof AiConfig,>(key: K, value: AiConfig[K]) => setConfig((current) => ({ ...current, [key]: value }));
    const closeDialog = () => {
        session.current++;
        selectorSession.current++;
        setModelSelectChannelId("");
        setConfigDialogOpen(false);
        useConfigStore.getState().clearPromptContinue();
    };
    const cancelConfig = () => {
        if (saveLock.current) return;
        if (!dirty) return closeDialog();
        const run = session.current;
        modal.confirm({
            title: "放弃未保存的修改？",
            content: "模型配置和存储设置尚未保存。",
            okText: "放弃修改",
            cancelText: "继续编辑",
            onOk: () => { if (isCurrentSession(run)) closeDialog(); },
        });
    };
    const patchLocalChannel = (id: string, patch: Partial<LocalModelChannel>) => {
        setChannelError(null);
        setConfig((current) => configWithChannels(current, current.localChannels.map((channel) => channel.id === id ? { ...channel, ...patch } : channel)));
    };
    const addLocalChannel = () => {
        const id = "local-" + crypto.randomUUID();
        setConfig((current) => configWithChannels(current, [...current.localChannels, { id, protocol: "openai", name: "新渠道", baseUrl: modelChannelDefaultBaseUrls.openai, apiKey: "", models: [] }]));
        setSelectedChannels((current) => ({ ...current, [section]: id }));
        setChannelError(null);
    };
    const referencedGroups = (id: string) => modelGroups.filter((item) => config[item.channelKey] === id && localChannels.find((channel) => channel.id === id)?.models.includes(config[item.modelKey]));
    const removeLocalChannel = () => {
        if (!selectedChannel) return;
        const references = referencedGroups(selectedChannel.id);
        if (references.length) {
            message.warning("请先更换" + references.map((item) => item.label).join("、") + "默认渠道");
            return;
        }
        const id = selectedChannel.id;
        const run = session.current;
        modal.confirm({
            title: "删除共享渠道？",
            content: `“${selectedChannel.name}”会从所有模型类型中移除，保存后生效。`,
            okText: "删除渠道",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: () => {
                if (isCurrentSession(run)) setConfig((current) => configWithChannels(current, current.localChannels.filter((channel) => channel.id !== id)));
            },
        });
    };
    const validateChannel = (channel: LocalModelChannel) => {
        const field = !channel.baseUrl.trim() ? "baseUrl" : !channel.apiKey.trim() ? "apiKey" : null;
        if (!field) return true;
        setChannelError({ id: channel.id, field, text: field === "baseUrl" ? "请填写 Base URL" : "请填写 API Key" });
        setModelSelectChannelId("");
        selectorSession.current++;
        requestAnimationFrame(() => (field === "baseUrl" ? baseUrlInput : apiKeyInput).current?.focus());
        return false;
    };
    const setDefaultModel = () => {
        if (!group || !selectedChannel || !availableModels.includes(candidateModel)) return;
        if (effectiveMode === "local" && !validateChannel(selectedChannel)) return;
        setConfig((current) => {
            const next = { ...current, [group.modelKey]: candidateModel, [group.channelKey]: selectedChannel.id };
            if (group.capability !== "video") return next;
            const effective = resolveEffectiveConfig(next, modelChannel, canUseRemoteChannel);
            const video = normalizeVideoConfig({ ...effective, model: candidateModel, videoModel: candidateModel, size: next.videoSize });
            return { ...next, vquality: video.vquality, videoSeconds: video.videoSeconds, videoSize: video.size, videoGenerateAudio: video.videoGenerateAudio };
        });
    };
    const closeLocalModelSelector = () => {
        selectorSession.current++;
        setModelSelectChannelId("");
    };
    const confirmLocalModelSelector = (models: string[]) => {
        if (!modelSelectChannel) return;
        const references = referencedGroups(modelSelectChannel.id).filter((item) => !models.includes(config[item.modelKey]));
        if (references.length) {
            message.warning("请先更换" + references.map((item) => item.label).join("、") + "默认模型，再移除该模型");
            return;
        }
        patchLocalChannel(modelSelectChannel.id, { models });
        closeLocalModelSelector();
    };
    const fetchLocalModelList = async () => {
        if (!modelSelectChannel || !validateChannel(modelSelectChannel)) return;
        const run = session.current;
        const selection = selectorSession.current;
        const channel = modelSelectChannel;
        const current = () => isCurrentSession(run) && selectorSession.current === selection && configRef.current.localChannels.some((item) => item.id === channel.id && item.protocol === channel.protocol && item.baseUrl === channel.baseUrl && item.apiKey === channel.apiKey);
        try {
            const models = await fetchImageModels(configForLocalChannel(config, channel));
            return current() ? uniqueModels(models) : undefined;
        } catch (error) {
            if (current()) throw error;
        }
    };
    const measureStorage = async (provider: UserStorageProvider) => {
        if (measureLock.current) return;
        if (!token) { message.warning("请先登录后再统计容量"); return; }
        measureLock.current = true;
        const run = session.current;
        setMeasuringStorageType(provider.type);
        try {
            const result = await measureUserStorageProvider(token, provider);
            if (!isCurrentSession(run)) return;
            const usage = formatBytes(result.bytes) + " / " + formatBytes(result.limitBytes) + (result.overLimit ? "，已达到上限" : "");
            if (provider.type === "webdav") {
                setWebDAVStorageUsageText(usage);
                if (result.overLimit) setUserWebDAVStorage((current) => JSON.stringify(current) === JSON.stringify(provider) ? { ...current, enabled: false } : current);
            } else {
                setStorageUsageText(usage);
                if (result.overLimit) setUserStorage((current) => JSON.stringify(current) === JSON.stringify(provider) ? { ...current, enabled: false } : current);
            }
            message.success("容量统计完成");
        } catch (error) {
            if (isCurrentSession(run)) message.error(error instanceof Error ? error.message : "容量统计失败");
        } finally {
            if (isCurrentSession(run)) { measureLock.current = false; setMeasuringStorageType(null); }
        }
    };
    const finishConfig = async () => {
        if (saveLock.current || measureLock.current || loadingConfig || loadError || !baseline) return;
        if (allowUserStorageProvider && userStorage.enabled && userWebDAVStorage.enabled) {
            setSection("storage");
            message.error("S3/R2 与 WebDAV 不能同时启用");
            return;
        }
        if (effectiveMode === "local") {
            const invalid = modelGroups.find((item) => {
                const channel = localChannels.find((channel) => channel.id === config[item.channelKey]);
                return channel?.models.includes(config[item.modelKey]) && !modelsFor(channel, item).includes(config[item.modelKey]);
            });
            if (invalid) { setSection(invalid.capability); message.error(`渠道协议已变更，请重新选择${invalid.label}默认模型`); return; }
        }
        saveLock.current = true;
        setSavingConfig(true);
        setSaveError("");
        const run = session.current;
        const configToSave = { ...configWithChannels(config), channelMode: effectiveMode, canvasImageCount: normalizeImageCount(config.canvasImageCount) };
        let stage = "sync";
        try {
            if (isLoggedIn) {
                remoteStorageSync.current.s3 ||= config.syncStorageConfig;
                remoteStorageSync.current.webdav ||= config.syncWebDAVStorageConfig;
                await syncUserModelConfig(token, configToSave);
                if (!isCurrentSession(run)) return;
                const providers = {
                    ...(remoteStorageSync.current.s3 ? { s3: config.syncStorageConfig ? userStorage : { ...userStorage, enabled: false, endpoint: "", bucket: "", accessKeyId: "", secretAccessKey: "" } } : {}),
                    ...(remoteStorageSync.current.webdav ? { webdav: config.syncWebDAVStorageConfig ? userWebDAVStorage : { ...userWebDAVStorage, enabled: false, endpoint: "", username: "", password: "" } } : {}),
                };
                if (allowUserStorageProvider && Object.keys(providers).length) await syncUserStorageProvider(token, providers);
            }
            if (!isCurrentSession(run)) return;
            stage = "local";
            if (allowUserStorageProvider) { saveUserStorageProvider(userStorage); saveUserWebDAVStorageProvider(userWebDAVStorage); }
            replaceConfig(configToSave);
            clearImageStorageCache();
            clearFileStorageCache();
            const continueRequest = useConfigStore.getState().shouldPromptContinue;
            const incomplete = effectiveMode === "local" && localChannels.some((channel) => !channel.baseUrl.trim() || !channel.apiKey.trim());
            closeDialog();
            if (incomplete) message.warning("配置已保存，部分渠道仍待配置" + (continueRequest ? "；请继续刚才的请求" : ""));
            else message.success(continueRequest ? "配置已保存，请继续刚才的请求" : "配置已保存");
        } catch (error) {
            if (isCurrentSession(run)) setSaveError((stage === "sync" ? "同步未完成，草稿已保留，请重试保存。账号端可能已有部分更新。" : "本地保存失败，草稿已保留，请重试。") + (error instanceof Error ? " " + error.message : ""));
        } finally {
            if (session.current === run) { saveLock.current = false; setSavingConfig(false); }
        }
    };
    const channelStatus = (channel: LocalModelChannel, item: ModelGroup) => {
        if (effectiveMode === "local" && (!channel.baseUrl.trim() || !channel.apiKey.trim())) return "待配置";
        if (!modelsFor(channel, item).length) return "暂无该类模型";
        if (defaultChannelFor(item)?.id !== channel.id) return "";
        const saved = baseline ? resolveEffectiveConfig(baseline.config, modelChannel, canUseRemoteChannel) : modelConfig;
        return saved.channelMode !== effectiveMode || baseline?.config[item.channelKey] !== config[item.channelKey] || baseline?.config[item.modelKey] !== config[item.modelKey] ? "默认 · 待保存" : "当前默认";
    };

    return (
        <>
            <Modal
                title={<div><div className="text-lg font-semibold">配置与用户偏好</div><div className={"mt-1 font-normal " + secondaryText}>选择模型类型、渠道，再设置默认模型与参数</div></div>}
                open={isConfigOpen}
                width={960}
                centered
                onCancel={cancelConfig}
                closable={!savingConfig}
                keyboard={!savingConfig}
                styles={{ body: { paddingTop: 12, maxHeight: "72vh", display: "flex", flexDirection: "column" } }}
                footer={<div className="flex items-center justify-end gap-2"><span className={"mr-auto " + secondaryText}>{dirty ? "有未保存的修改" : ""}</span><Button disabled={savingConfig} onClick={cancelConfig}>取消</Button><Button type="primary" loading={savingConfig} disabled={loadingConfig || Boolean(loadError) || !baseline || Boolean(measuringStorageType)} onClick={() => void finishConfig()}>保存</Button></div>}
            >
                {loadingConfig ? <div className="flex h-72 items-center justify-center gap-3"><Spin /><span className={secondaryText}>正在加载配置…</span></div> : loadError ? <Alert type="error" title="配置加载失败" description={loadError} action={<Button onClick={() => setReload((value) => value + 1)}>重试</Button>} /> : (
                    <div className="flex min-h-0 flex-col gap-3">
                        {saveError ? <Alert className="max-h-36 shrink-0 overflow-y-auto" type="error" title="保存未完成" description={saveError} showIcon /> : null}
                        {allowCustomChannel && canUseRemoteChannel ? <Segmented block value={effectiveMode} disabled={savingConfig} options={[{ label: "本地直连", value: "local" }, { label: "云端渠道", value: "remote" }]} onChange={(value) => { updateConfig("channelMode", value as AiConfig["channelMode"]); setChannelError(null); }} /> : null}
                        <div className="flex h-[min(60vh,640px)] min-h-0 flex-col gap-4 md:flex-row">
                            <nav aria-label="配置分类" className="hidden w-60 shrink-0 overflow-y-auto border-r border-[var(--ant-color-border-secondary)] pr-3 md:block">
                                {modelGroups.map((item) => (
                                    <div key={item.capability} className="mb-1">
                                        <button type="button" disabled={savingConfig} aria-expanded={section === item.capability} aria-controls={"config-channels-" + item.capability} className={navigationItem + " flex items-center justify-between font-medium"} onClick={() => setSection(item.capability)}>{item.label}模型{section === item.capability ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                                        {section === item.capability ? <div id={"config-channels-" + item.capability} className="mb-3 space-y-1">
                                            {channelsFor(item).map((channel) => <button type="button" key={channel.id} disabled={savingConfig} aria-current={selectedChannel?.id === channel.id ? "page" : undefined} className={navigationItem + (selectedChannel?.id === channel.id ? " bg-[var(--ant-color-fill-secondary)]" : "")} onClick={() => { setSelectedChannels((current) => ({ ...current, [item.capability]: channel.id })); setChannelError(null); }}><span className="block truncate text-sm">{channel.name || "未命名渠道"}</span>{channelStatus(channel, item) ? <span className={secondaryText}>{channelStatus(channel, item)}</span> : null}</button>)}
                                            {!channelsFor(item).length ? <div className={"px-3 py-2 " + secondaryText}>暂无可用渠道</div> : null}
                                            {effectiveMode === "local" ? <Button type="text" block icon={<Plus size={14} />} disabled={savingConfig} onClick={addLocalChannel}>新增渠道</Button> : null}
                                        </div> : null}
                                    </div>
                                ))}
                                <div className="mt-4 border-t border-[var(--ant-color-border-secondary)] pt-3">
                                    {sectionOptions.slice(4).map((item) => <button key={item.value} type="button" disabled={savingConfig} aria-current={section === item.value ? "page" : undefined} className={navigationItem + (section === item.value ? " bg-[var(--ant-color-fill-secondary)]" : "")} onClick={() => setSection(item.value as ConfigSection)}>{item.label}</button>)}
                                </div>
                            </nav>
                            <div className="flex shrink-0 flex-col gap-2 md:hidden">
                                <Select aria-label="模型类型与偏好分类" value={section} options={sectionOptions} disabled={savingConfig} onChange={setSection} />
                                {group ? <div className="flex gap-2"><Select aria-label="模型渠道" className="min-w-0 flex-1" value={selectedChannel?.id} placeholder="选择渠道" disabled={savingConfig} options={availableChannels.map((channel) => ({ value: channel.id, label: `${channel.name || "未命名渠道"}${channelStatus(channel, group) ? " · " + channelStatus(channel, group) : ""}` }))} onChange={(id) => { setSelectedChannels((current) => ({ ...current, [section]: id })); setChannelError(null); }} />{effectiveMode === "local" ? <Button aria-label="新增渠道" icon={<Plus size={14} />} disabled={savingConfig} onClick={addLocalChannel} /> : null}</div> : null}
                            </div>
                            <main className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1 md:pl-1" aria-label="配置参数">
                                <Form layout="vertical" requiredMark={false} disabled={savingConfig}>
                                    {group ? <>
                                        {selectedChannel ? <section>
                                            <div className="mb-5 flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="m-0 truncate text-base font-semibold">{selectedChannel.name || "未命名渠道"}</h3><p className={"mb-0 mt-1 " + secondaryText}>{effectiveMode === "local" ? "共享渠道：名称、协议、地址、密钥和模型列表对所有模型类型生效。" : "云端渠道由系统后台管理，选择模型后可设为当前类型默认。"}</p></div>{effectiveMode === "local" ? <Button type="text" danger disabled={savingConfig || localChannels.length === 1} onClick={removeLocalChannel}>删除</Button> : null}</div>
                                            {effectiveMode === "local" ? <>
                                                <div className="grid gap-x-4 sm:grid-cols-2">
                                                    <Form.Item label="渠道名称"><Input aria-label="渠道名称" value={selectedChannel.name} onChange={(event) => patchLocalChannel(selectedChannel.id, { name: event.target.value })} /></Form.Item>
                                                    <Form.Item label="渠道协议"><Select aria-label="渠道协议" value={selectedChannel.protocol} options={modelChannelProtocolOptions} onChange={(protocol: LocalModelChannel["protocol"]) => patchLocalChannel(selectedChannel.id, { protocol, baseUrl: modelChannelDefaultBaseUrls[protocol] })} /></Form.Item>
                                                </div>
                                                <Form.Item label="Base URL" validateStatus={channelError?.id === selectedChannel.id && channelError.field === "baseUrl" ? "error" : undefined} help={channelError?.id === selectedChannel.id && channelError.field === "baseUrl" ? channelError.text : undefined} extra={modelChannelBaseUrlPresets[selectedChannel.protocol] ? <span className="flex flex-wrap gap-3">{modelChannelBaseUrlPresets[selectedChannel.protocol]?.map((item) => <a key={item.value} title={item.value} onClick={() => patchLocalChannel(selectedChannel.id, { baseUrl: item.value })}>{item.label}</a>)}</span> : undefined}><Input aria-label="Base URL" ref={baseUrlInput} value={selectedChannel.baseUrl} placeholder="填写渠道接口地址" onChange={(event) => patchLocalChannel(selectedChannel.id, { baseUrl: event.target.value })} /></Form.Item>
                                                <Form.Item label="API Key" validateStatus={channelError?.id === selectedChannel.id && channelError.field === "apiKey" ? "error" : undefined} help={channelError?.id === selectedChannel.id && channelError.field === "apiKey" ? channelError.text : undefined} extra={modelChannelApiKeyUrls[selectedChannel.protocol] ? <a href={modelChannelApiKeyUrls[selectedChannel.protocol]} target="_blank" rel="noreferrer">获取 API Key</a> : undefined}><Input.Password aria-label="API Key" ref={apiKeyInput} autoComplete="off" value={selectedChannel.apiKey} placeholder="填写渠道密钥" onChange={(event) => patchLocalChannel(selectedChannel.id, { apiKey: event.target.value })} /></Form.Item>
                                            </> : <div className={"mb-5 space-y-1 " + secondaryText}><div>协议：{modelChannelProtocolOptions.find((item) => item.value === selectedChannel.protocol)?.label}</div>{selectedChannel.baseUrl ? <div className="break-all">地址：{selectedChannel.baseUrl}</div> : null}</div>}
                                            <Form.Item label={group.label + "模型"} extra={!availableModels.length ? (effectiveMode === "local" ? "暂无该类模型，请管理渠道模型列表。" : "暂无该类模型，请联系管理员。") : undefined}>
                                                <div className="flex flex-wrap gap-2"><Select aria-label={group.label + "模型"} className="min-w-0 flex-1" style={{ minWidth: 180 }} showSearch optionFilterProp="label" placeholder="选择模型" value={availableModels.includes(candidateModel) ? candidateModel : undefined} options={availableModels.map((model) => ({ value: model, label: model }))} onChange={(model) => setCandidateModels((current) => ({ ...current, [candidateKey]: model }))} />{effectiveMode === "local" ? <Button onClick={() => { selectorSession.current++; setModelSelectChannelId(selectedChannel.id); }}>管理模型</Button> : null}</div>
                                            </Form.Item>
                                            <div className="mb-6 flex flex-wrap items-center gap-3"><Button disabled={savingConfig || isDefault || !availableModels.includes(candidateModel)} onClick={setDefaultModel}>{isDefault ? "已设为" + group.label + "默认" : "设为" + group.label + "默认"}</Button><span className={secondaryText}>保存后生效</span></div>
                                        </section> : <Empty className="py-8" description="当前类型暂无可用渠道" />}
                                        <section className="border-t border-[var(--ant-color-border-secondary)] pt-5">
                                            <h3 className="mb-1 text-sm font-semibold">当前{group.label}默认{section === "image" || section === "audio" || section === "video" && miniMax ? "参数" : "模型"}</h3>
                                            <p className={"mb-4 break-all " + secondaryText}>{defaultChannelFor(group) ? `${defaultChannelFor(group)?.name} / ${modelConfig[group.modelKey]}` : "尚未配置可用的默认模型"}</p>
                                            {section === "video" && miniMax ? <>
                                                <Form.Item label="默认清晰度"><Select value={normalizeMiniMaxH3Resolution(config.vquality, modelConfig.videoModel)} options={miniMax.resolutions.map((value) => ({ value, label: value }))} onChange={(value) => updateConfig("vquality", value)} /></Form.Item>
                                                <Form.Item label="默认时长（秒）"><Input type="number" min={miniMax.minSeconds} max={15} value={normalizeMiniMaxH3Duration(config.videoSeconds, modelConfig.videoModel)} onChange={(event) => updateConfig("videoSeconds", String(normalizeMiniMaxH3Duration(event.target.value, modelConfig.videoModel)))} /></Form.Item>
                                                <Form.Item label="默认比例" extra="文生视频的自适应默认使用 16:9；首尾帧模式跟随首帧。"><Select value={normalizeMiniMaxH3Ratio(config.videoSize)} options={[...miniMaxRatioOptions]} onChange={(value) => updateConfig("videoSize", value)} /></Form.Item>
                                            </> : null}
                                            {section === "image" ? <>
                                                <Form.Item label="画布默认生图张数" extra="新建画布生图和配置节点默认使用，单个节点仍可单独覆盖。"><Input type="number" min={1} max={15} value={config.canvasImageCount} onChange={(event) => updateConfig("canvasImageCount", event.target.value)} onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))} /></Form.Item>
                                                <div className="space-y-3">
                                                    <FeatureSwitch title="流式传输" description="读取中间图片事件，避免长时间无数据。" checked={Boolean(config.streamImages)} onChange={(checked) => updateConfig("streamImages", checked ? "1" : "")} />
                                                    <FeatureSwitch title="返回 Base64 图片数据" description="图片接口返回 Base64 格式的数据。" checked={Boolean(config.responseFormatB64Json)} onChange={(checked) => updateConfig("responseFormatB64Json", checked ? "1" : "")} />
                                                    <FeatureSwitch title="Codex CLI 兼容模式" description="减少不兼容参数，并追加防提示词改写前缀。" checked={Boolean(config.codexCli)} onChange={(checked) => updateConfig("codexCli", checked ? "1" : "")} />
                                                </div>
                                            </> : null}
                                            {section === "audio" ? <>
                                                <div className="grid gap-x-4 sm:grid-cols-2">
                                                    {geminiTts ? (
                                                        <Form.Item label="默认 Gemini 音色" className="mb-4">
                                                            <Select showSearch optionFilterProp="label" value={normalizeGeminiTtsVoice(config.geminiTtsVoice)} options={geminiTtsVoiceOptions} onChange={(value) => updateConfig("geminiTtsVoice", value)} />
                                                        </Form.Item>
                                                    ) : isMimoPresetTtsModel(modelConfig.audioModel) ? (
                                                        <Form.Item label="默认 MiMo 音色" className="mb-4">
                                                            <Select value={config.mimoTtsVoice} options={[...mimoTtsVoiceOptions]} onChange={(value) => updateConfig("mimoTtsVoice", value)} />
                                                        </Form.Item>
                                                    ) : isMimoVoiceDesignModel(modelConfig.audioModel) ? (
                                                        <Form.Item label="默认音色描述" className="mb-4">
                                                            <Input value={config.mimoVoiceDesignPrompt} placeholder="例如：年轻女性，声音清亮自然，有亲和力。" onChange={(event) => updateConfig("mimoVoiceDesignPrompt", event.target.value)} />
                                                        </Form.Item>
                                                    ) : isMimoTtsModel(modelConfig.audioModel) ? null : (
                                                        <Form.Item label="默认音频声音" className="mb-4">
                                                            <Select value={glmTts ? normalizeGlmTtsVoice(config.glmTtsVoice) : config.audioVoice} options={glmTts ? glmTtsVoiceOptions : audioVoiceOptions} onChange={(value) => updateConfig(glmTts ? "glmTtsVoice" : "audioVoice", value)} />
                                                        </Form.Item>
                                                    )}
                                                    {!geminiTts ? (
                                                        <Form.Item label="默认音频格式" className="mb-4">
                                                            <Select value={isMimoTtsModel(modelConfig.audioModel) ? config.mimoTtsFormat : glmTts ? normalizeGlmTtsFormat(config.glmTtsFormat) : config.audioFormat} options={isMimoTtsModel(modelConfig.audioModel) ? [...mimoTtsFormatOptions] : glmTts ? glmTtsFormatOptions : audioFormatOptions} onChange={(value) => isMimoTtsModel(modelConfig.audioModel) ? updateConfig("mimoTtsFormat", value) : updateConfig(glmTts ? "glmTtsFormat" : "audioFormat", value)} />
                                                        </Form.Item>
                                                    ) : null}
                                                    {!geminiTts && !isMimoTtsModel(modelConfig.audioModel) ? (
                                                        <Form.Item label="默认音频语速" className="mb-4">
                                                            <Input
                                                                type="number"
                                                                min={glmTts ? 0.5 : 0.25}
                                                                max={glmTts ? 2 : 4}
                                                                step={0.05}
                                                                value={glmTts ? config.glmTtsSpeed : config.audioSpeed}
                                                                onChange={(event) => updateConfig(glmTts ? "glmTtsSpeed" : "audioSpeed", event.target.value)}
                                                                onBlur={(event) => updateConfig(glmTts ? "glmTtsSpeed" : "audioSpeed", glmTts ? normalizeGlmTtsSpeed(event.target.value) : normalizeAudioSpeedValue(event.target.value))}
                                                            />
                                                        </Form.Item>
                                                    ) : null}
                                                </div>
                                                {(!isMimoTtsModel(modelConfig.audioModel) || isMimoPresetTtsModel(modelConfig.audioModel) || isMimoVoiceCloneModel(modelConfig.audioModel)) && !glmTts ? (
                                                    <Form.Item label="默认音频指令" className="mb-4">
                                                        <Input.TextArea rows={2} value={config.audioInstructions} placeholder="例如：自然、温暖、适合旁白。" onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                                                    </Form.Item>
                                                ) : null}
                                            </> : null}
                                        </section>
                                    </> : section === "general" ? <>
                                        <h3 className="mb-4 text-base font-semibold">通用偏好</h3>
                                        <Form.Item label="系统提示词" extra={effectiveMode === "local" ? "用于没有单独指定系统提示词的生成请求。" : "云端模式的系统提示词由后台统一管理。"}><Input.TextArea rows={6} readOnly={effectiveMode === "remote"} value={effectiveMode === "remote" ? modelConfig.systemPrompt : config.systemPrompt} placeholder="例如：你是一位擅长电影感写实摄影的视觉导演。" onChange={(event) => updateConfig("systemPrompt", event.target.value)} /></Form.Item>
                                    </> : <>
                                        <h3 className="mb-4 text-base font-semibold">存储设置</h3>
                                        {allowUserStorageProvider && !isLoggedIn ? <p className={"mb-4 " + secondaryText}>未登录时配置仅保存在当前浏览器，登录后保存可同步到账号。</p> : null}
                                        {!allowUserStorageProvider ? <Empty description="系统暂未开放用户自定义存储" /> : null}
                                        {allowUserStorageProvider ? (
                                            <>
                                                <section className="mb-6 space-y-3 border-b border-[var(--ant-color-border-secondary)] pb-6">
                                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                                        <div>
                                                            <div className="text-sm font-medium">用户 S3/R2 存储</div>
                                                            <div className="mt-1 text-xs text-[var(--ant-color-text-secondary)]">
                                                                开启后，新生成图片和媒体文件会优先保存到你的 S3 兼容对象存储。
                                                                {storageUsageText ? <>当前容量：{storageUsageText}</> : null}
                                                            </div>
                                                        </div>
                                                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                                                            <Button size="small" loading={measuringStorageType === "s3"} onClick={() => void measureStorage(userStorage)}>
                                                                统计容量
                                                            </Button>
                                                            <span className="text-xs text-[var(--ant-color-text-secondary)]">同步到账号</span>
                                                            <Switch aria-label="同步 S3/R2 配置到账号" size="small" checked={config.syncStorageConfig} onChange={(checked) => updateConfig("syncStorageConfig", checked)} />
                                                            <Switch aria-label="启用 S3/R2 存储" checked={userStorage.enabled} disabled={savingConfig || userWebDAVStorage.enabled} onChange={(enabled) => setUserStorage((value) => ({ ...value, enabled }))} />
                                                        </div>
                                                    </div>
                                                    {userStorage.enabled ? (
                                                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                                                            <Input value={userStorage.name} placeholder="配置名称" onChange={(event) => setUserStorage((value) => ({ ...value, name: event.target.value }))} />
                                                            <Input value={userStorage.endpoint} placeholder="Endpoint，例如 https://<account>.r2.cloudflarestorage.com" onChange={(event) => setUserStorage((value) => ({ ...value, endpoint: event.target.value }))} />
                                                            <Input value={userStorage.region} placeholder="Region，R2 通常为 auto" onChange={(event) => setUserStorage((value) => ({ ...value, region: event.target.value }))} />
                                                            <Input value={userStorage.bucket} placeholder="Bucket 名称" onChange={(event) => setUserStorage((value) => ({ ...value, bucket: event.target.value }))} />
                                                            <Input value={userStorage.accessKeyId} placeholder="Access Key ID" onChange={(event) => setUserStorage((value) => ({ ...value, accessKeyId: event.target.value }))} />
                                                            <Input.Password value={userStorage.secretAccessKey} placeholder="Secret Access Key" onChange={(event) => setUserStorage((value) => ({ ...value, secretAccessKey: event.target.value }))} />
                                                            <Input value={userStorage.publicBaseUrl} placeholder="公开访问地址，例如 https://pub-xxx.r2.dev" onChange={(event) => setUserStorage((value) => ({ ...value, publicBaseUrl: event.target.value }))} />
                                                            <Input value={userStorage.pathPrefix} placeholder="保存路径前缀，例如 images" onChange={(event) => setUserStorage((value) => ({ ...value, pathPrefix: event.target.value }))} />
                                                        </div>
                                                    ) : null}
                                                </section>
                                                <section className="mb-6 space-y-3 border-b border-[var(--ant-color-border-secondary)] pb-6">
                                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                                        <div>
                                                            <div className="text-sm font-medium">WebDAV 存储</div>
                                                            <div className="mt-1 text-xs text-[var(--ant-color-text-secondary)]">
                                                                开启后，新生成图片和媒体文件会优先保存到你的 WebDAV。
                                                                {webDAVStorageUsageText ? <>当前容量：{webDAVStorageUsageText}</> : null}
                                                            </div>
                                                        </div>
                                                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                                                            <Button size="small" loading={measuringStorageType === "webdav"} onClick={() => void measureStorage(userWebDAVStorage)}>
                                                                统计容量
                                                            </Button>
                                                            <span className="text-xs text-[var(--ant-color-text-secondary)]">同步到账号</span>
                                                            <Switch aria-label="同步 WebDAV 配置到账号" size="small" checked={config.syncWebDAVStorageConfig} onChange={(checked) => updateConfig("syncWebDAVStorageConfig", checked)} />
                                                            <Switch aria-label="启用 WebDAV 存储" checked={userWebDAVStorage.enabled} disabled={savingConfig || userStorage.enabled} onChange={(enabled) => setUserWebDAVStorage((value) => ({ ...value, enabled }))} />
                                                        </div>
                                                    </div>
                                                    {userWebDAVStorage.enabled ? (
                                                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                                                            <Input value={userWebDAVStorage.name} placeholder="配置名称" onChange={(event) => setUserWebDAVStorage((value) => ({ ...value, name: event.target.value }))} />
                                                            <Input value={userWebDAVStorage.endpoint} placeholder="WebDAV 地址" onChange={(event) => setUserWebDAVStorage((value) => ({ ...value, endpoint: event.target.value }))} />
                                                            <Input value={userWebDAVStorage.pathPrefix} placeholder="远程目录" onChange={(event) => setUserWebDAVStorage((value) => ({ ...value, pathPrefix: event.target.value }))} />
                                                            <Input value={userWebDAVStorage.username} placeholder="用户名" onChange={(event) => setUserWebDAVStorage((value) => ({ ...value, username: event.target.value }))} />
                                                            <Input.Password value={userWebDAVStorage.password} placeholder="密码 / 应用密码" onChange={(event) => setUserWebDAVStorage((value) => ({ ...value, password: event.target.value }))} />
                                                        </div>
                                                    ) : null}
                                                </section>
                                            </>
                                        ) : null}
                                    </>}
                                </Form>
                            </main>
                        </div>
                    </div>
                )}
            </Modal>
            {isConfigOpen && modelSelectChannel ? <ChannelModelSelectorModal key={modelSelectChannel.id} models={modelSelectChannel.models} onCancel={closeLocalModelSelector} onConfirm={confirmLocalModelSelector} onFetchModels={fetchLocalModelList} /> : null}
        </>
    );
}

function FeatureSwitch({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return <div className="py-1"><div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm">{title}</span><Switch aria-label={title} checked={checked} onChange={onChange} /></div><p className={"mb-0 mt-1 " + secondaryText}>{description}</p></div>;
}

function configWithChannels(config: AiConfig, channels = normalizeLocalChannels(config)): AiConfig {
    return {
        ...config,
        localChannels: channels,
        models: uniqueModels(channels.flatMap((channel) => channel.models)),
        imageModels: filterChannelModelsByCapability(channels, "image"),
        videoModels: filterChannelModelsByCapability(channels, "video"),
        audioModels: filterChannelModelsByCapability(channels, "audio"),
        textModels: filterChannelModelsByCapability(channels, "text"),
        baseUrl: channels[0]?.baseUrl || "",
        apiKey: channels[0]?.apiKey || "",
    };
}

function modelsFor(channel: LocalModelChannel, group: ModelGroup) {
    return filterModelsByCapability(channel.models, group.capability, channel.protocol);
}

function configForLocalChannel(config: AiConfig, channel: LocalModelChannel): AiConfig {
    return { ...config, channelMode: "local", baseUrl: channel.baseUrl, apiKey: channel.apiKey, localChannels: [channel], imageChannelId: channel.id, videoChannelId: channel.id, textChannelId: channel.id, audioChannelId: channel.id, model: channel.models[0] || config.model };
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}

function uniqueModels(models: string[]) {
    return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
