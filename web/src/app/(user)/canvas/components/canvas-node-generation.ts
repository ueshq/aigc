import { defaultConfig, resolveModelForCapability, type AiConfig } from "@/stores/use-config-store";
import { normalizeVideoConfig } from "@/lib/video-model-capabilities";
import type { ReferenceImage, ReferenceAudio, ReferenceVideo } from "@/types/media";
import type { ChatCompletionMessage } from "@/services/api/image";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import { CanvasNodeType, type CanvasConnection, type CanvasGenerationMode, type CanvasNodeData } from "../types";
import { PANORAMA_IMAGE_SIZE, isCanvasImageNodeType, isPanoramaNodeType } from "../utils/canvas-panorama";
import { getGenerationResourceNodes } from "../utils/canvas-resource-references";

export type NodeGenerationContext = {
    prompt: string;
    referenceImages: ReferenceImage[];
    firstFrame: ReferenceImage | null;
    lastFrame: ReferenceImage | null;
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    textCount: number;
    imageCount: number;
    videoCount: number;
    audioCount: number;
};

export type NodeGenerationInput = {
    nodeId: string;
    type: "text" | "image" | "video" | "audio";
    title: string;
    text?: string;
    image?: ReferenceImage;
    video?: ReferenceVideo;
    audio?: ReferenceAudio;
};

export function buildNodeGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string): NodeGenerationContext {
    const inputs = buildNodeGenerationInputs(nodeId, nodes, connections);
    const sourceNode = nodes.find((node) => node.id === nodeId);
    if (sourceNode?.type === CanvasNodeType.Config && Boolean(sourceNode.metadata?.composerContent?.trim())) {
        return buildComposerGenerationContext(inputs, prompt, sourceNode);
    }

    const upstreamText = sourceNode?.metadata?.excludeUpstreamText? "": inputs
            .map((input) => input.text)
            .filter(Boolean)
            .join("\n\n");
    const referenceImages = inputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = inputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = inputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));
    const frameReferences = readFrameReferences(sourceNode, inputs);
    const frameNodeIds = new Set([frameReferences.firstFrame?.id, frameReferences.lastFrame?.id].filter((id): id is string => Boolean(id)));
    const effectiveReferenceImages = referenceImages.filter((image) => !frameNodeIds.has(image.id));

    return {
        prompt: upstreamText ? `${prompt}\n\n${upstreamText}` : prompt,
        referenceImages: effectiveReferenceImages,
        firstFrame: frameReferences.firstFrame,
        lastFrame: frameReferences.lastFrame,
        referenceVideos,
        referenceAudios,
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

function buildComposerGenerationContext(inputs: NodeGenerationInput[], prompt: string, sourceNode?: CanvasNodeData): NodeGenerationContext {
    const inputByNodeId = new Map(inputs.map((input) => [input.nodeId, input]));
    const selectedInputs: NodeGenerationInput[] = [];
    const labelByNodeId = new Map<string, string>();
    const textBlocks: string[] = [];
    const counts = { image: 0, video: 0, audio: 0, text: 0 };
    let hasToken = false;
    let lastIndex = 0;
    let nextPrompt = "";

    for (const match of prompt.matchAll(/@\[node:([^\]]+)\]/g)) {
        if (match.index === undefined) continue;
        hasToken = true;
        nextPrompt += prompt.slice(lastIndex, match.index);
        const input = inputByNodeId.get(match[1]);
        if (input) {
            let label = labelByNodeId.get(input.nodeId);
            if (!label) {
                label = generationLabel(input.type, counts[input.type]++);
                labelByNodeId.set(input.nodeId, label);
                if (input.type === "text") textBlocks.push(`【${label}】\n${input.text || ""}`);
                else selectedInputs.push(input);
            }
            nextPrompt += input.type === "text" ? `【${label}】` : label;
        }
        lastIndex = match.index + match[0].length;
    }

    nextPrompt += prompt.slice(lastIndex);
    if (textBlocks.length) nextPrompt = `${nextPrompt.trim()}\n\n${textBlocks.join("\n\n")}`;
    const referenceImages = selectedInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = selectedInputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = selectedInputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));
    const frameReferences = readFrameReferences(sourceNode, inputs);
    const frameNodeIds = new Set([frameReferences.firstFrame?.id, frameReferences.lastFrame?.id].filter((id): id is string => Boolean(id)));
    const effectiveReferenceImages = referenceImages.filter((image) => !frameNodeIds.has(image.id));

    if (!hasToken) {
        return {
            prompt,
            referenceImages: [],
            firstFrame: frameReferences.firstFrame,
            lastFrame: frameReferences.lastFrame,
            referenceVideos: [],
            referenceAudios: [],
            textCount: 0,
            imageCount: 0,
            videoCount: 0,
            audioCount: 0,
        };
    }

    return {
        prompt: nextPrompt,
        referenceImages: effectiveReferenceImages,
        firstFrame: frameReferences.firstFrame,
        lastFrame: frameReferences.lastFrame,
        referenceVideos,
        referenceAudios,
        textCount: counts.text,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

export function buildNodeGenerationInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): NodeGenerationInput[] {
    return getGenerationResourceNodes(nodeId, nodes, connections).flatMap((node): NodeGenerationInput[] => {
        const image = readReferenceImage(node);
        if (image) return [{ nodeId: node.id, type: "image" as const, title: node.title, image }];
        const video = readReferenceVideo(node);
        if (video) return [{ nodeId: node.id, type: "video" as const, title: node.title, video }];
        const audio = readReferenceAudio(node);
        if (audio) return [{ nodeId: node.id, type: "audio" as const, title: node.title, audio }];
        const text = readNodeTextInput(node);
        if (text) return [{ nodeId: node.id, type: "text" as const, title: node.title, text }];
        return [];
    });
}

export function buildNodeChatMessages(context: NodeGenerationContext): ChatCompletionMessage[] {
    if (!context.referenceImages.length) {
        return [{ role: "user", content: context.prompt }];
    }

    return [
        {
            role: "user",
            content: [{ type: "text" as const, text: context.prompt }, ...context.referenceImages.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl } }))],
        },
    ];
}

export async function hydrateNodeGenerationContext(context: NodeGenerationContext) {
    const { imageToDataUrl } = await import("@/services/image-storage");
    return {
        ...context,
        referenceImages: await Promise.all(context.referenceImages.map(async (image) => ({ ...image, dataUrl: await imageToDataUrl(image) }))),
        firstFrame: context.firstFrame ? { ...context.firstFrame, dataUrl: await imageToDataUrl(context.firstFrame) } : null,
        lastFrame: context.lastFrame ? { ...context.lastFrame, dataUrl: await imageToDataUrl(context.lastFrame) } : null,
    };
}

function readNodeTextInput(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || "";
    return node.metadata?.prompt || "";
}

function generationLabel(type: NodeGenerationInput["type"], index: number) {
    if (type === "image") return imageReferenceLabel(index);
    if (type === "video") return seedanceReferenceLabel("video", index);
    if (type === "audio") return seedanceReferenceLabel("audio", index);
    return `文本${index + 1}`;
}

function readReferenceImage(node: CanvasNodeData): ReferenceImage | null {
    if (!isCanvasImageNodeType(node.type) || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `image-${node.id}.png`,
        type: node.metadata.mimeType || "image/png",
        dataUrl: node.metadata.content,
        bytes: node.metadata.bytes,
        width: node.metadata.naturalWidth,
        height: node.metadata.naturalHeight,
        storageKey: node.metadata.storageKey,
    };
}

function readFrameReferences(node: CanvasNodeData | undefined, inputs: NodeGenerationInput[]) {
    const imageByNodeId = new Map(inputs.filter((input) => input.image).map((input) => [input.nodeId, input.image as ReferenceImage]));
    return {
        firstFrame: node?.metadata?.firstFrameNodeId ? imageByNodeId.get(node.metadata.firstFrameNodeId) || null : null,
        lastFrame: node?.metadata?.lastFrameNodeId ? imageByNodeId.get(node.metadata.lastFrameNodeId) || null : null,
    };
}

function readReferenceVideo(node: CanvasNodeData): ReferenceVideo | null {
    if (node.type !== CanvasNodeType.Video || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `video-${node.id}.mp4`,
        type: node.metadata.mimeType || "video/mp4",
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        bytes: node.metadata.bytes,
        width: node.metadata.naturalWidth,
        height: node.metadata.naturalHeight,
        durationMs: node.metadata.seconds ? Number(node.metadata.seconds) * 1000 : node.metadata.durationMs,
    };
}

function readReferenceAudio(node: CanvasNodeData): ReferenceAudio | null {
    if (node.type !== CanvasNodeType.Audio || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `audio-${node.id}.mp3`,
        type: node.metadata.mimeType || "audio/mpeg",
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        bytes: node.metadata.bytes,
        durationMs: node.metadata.durationMs,
    };
}

export function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? config.imageModel : mode === "video" ? config.videoModel : mode === "audio" ? config.audioModel : config.textModel;
    const channelId = node?.metadata?.channelId || "";
    const imageChannelId = mode === "image" ? channelId || config.imageChannelId : config.imageChannelId;
    const videoChannelId = mode === "video" ? channelId || config.videoChannelId : config.videoChannelId;
    const textChannelId = mode === "text" ? channelId || config.textChannelId : config.textChannelId;
    const audioChannelId = mode === "audio" ? channelId || config.audioChannelId : config.audioChannelId;
    const activeChannelId = mode === "image" ? imageChannelId : mode === "video" ? videoChannelId : mode === "text" ? textChannelId : mode === "audio" ? audioChannelId || config.activeChannelId : config.activeChannelId;
    const result: AiConfig = {
        ...config,
        model: mode === "text" ? resolveModelForCapability(config, node?.metadata?.model, "text") : node?.metadata?.model || defaultModel || (mode === "audio" ? defaultConfig.audioModel : config.model || defaultConfig.model),
        activeChannelId,
        imageChannelId,
        videoChannelId,
        textChannelId,
        audioChannelId,
        quality: node?.metadata?.quality || config.quality || defaultConfig.quality,
        size: isPanoramaNodeType(node?.type) ? PANORAMA_IMAGE_SIZE : node?.metadata?.size || (mode === "video" ? config.videoSize || defaultConfig.videoSize : config.size || defaultConfig.size),
        videoSeconds: node?.metadata?.seconds || config.videoSeconds || defaultConfig.videoSeconds,
        vquality: node?.metadata?.vquality || config.vquality || defaultConfig.vquality,
        videoGenerateAudio: node?.metadata?.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node?.metadata?.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node?.metadata?.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: node?.metadata?.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node?.metadata?.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node?.metadata?.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        glmTtsVoice: node?.metadata?.glmTtsVoice || config.glmTtsVoice || defaultConfig.glmTtsVoice,
        glmTtsFormat: node?.metadata?.glmTtsFormat || config.glmTtsFormat || defaultConfig.glmTtsFormat,
        glmTtsSpeed: node?.metadata?.glmTtsSpeed || config.glmTtsSpeed || defaultConfig.glmTtsSpeed,
        mimoTtsVoice: node?.metadata?.mimoTtsVoice || config.mimoTtsVoice || defaultConfig.mimoTtsVoice,
        mimoTtsFormat: node?.metadata?.mimoTtsFormat || config.mimoTtsFormat || defaultConfig.mimoTtsFormat,
        mimoVoiceDesignPrompt: node?.metadata?.mimoVoiceDesignPrompt || config.mimoVoiceDesignPrompt || defaultConfig.mimoVoiceDesignPrompt,
        geminiTtsVoice: node?.metadata?.geminiTtsVoice || config.geminiTtsVoice || defaultConfig.geminiTtsVoice,
        count: String(node?.metadata?.count || (mode === "image" ? config.canvasImageCount || config.count : config.count) || defaultConfig.count),
    };
    return mode === "video" ? normalizeVideoConfig(result) : result;
}


export function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    return { [key]: value };
}
