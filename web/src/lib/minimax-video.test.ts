import assert from "node:assert/strict";
import test from "node:test";
import { miniMaxModels, miniMaxVideoInputError, normalizeMiniMaxH3Duration, normalizeMiniMaxH3Ratio, normalizeMiniMaxH3Resolution, normalizeMiniMaxVideoConfig, type MiniMaxVideoReferences } from "./minimax-video";
import { buildGenerationConfig, videoConfigPatch } from "../app/(user)/canvas/components/canvas-node-generation";
import { CanvasNodeType, type CanvasNodeData } from "../app/(user)/canvas/types";
import { PANORAMA_IMAGE_SIZE } from "../app/(user)/canvas/utils/canvas-panorama";
import { normalizeVideoConfig } from "./video-model-capabilities";
import { defaultConfig } from "../stores/use-config-store";

const image = { id: "image", name: "frame.png", type: "image/png", dataUrl: "https://media.example/frame.png", width: 768, height: 768 };
const audio = { id: "audio", name: "ref.mp3", type: "audio/mpeg", url: "https://media.example/ref.mp3", durationMs: 5000 };
const video = { id: "video", name: "ref.mp4", type: "video/mp4", url: "https://media.example/ref.mp4", durationMs: 5000, width: 1280, height: 720 };
const empty: MiniMaxVideoReferences = { references: [], videoReferences: [], audioReferences: [], firstFrame: null, lastFrame: null };

test("official model defaults, limits and mode ratios", () => {
    assert.deepEqual(miniMaxModels, ["MiniMax-H3", "MiniMax-H3-Max"]);
    for (const [model, minimum] of [["MiniMax-H3", 4], ["MiniMax-H3-Max", 5]] as const) {
        assert.equal(normalizeMiniMaxH3Duration("", model), 5);
        assert.equal(normalizeMiniMaxH3Duration("2", model), minimum);
        assert.equal(normalizeMiniMaxH3Duration("30", model), 15);
        assert.equal(normalizeMiniMaxH3Resolution("", model), "768P");
    }
    assert.equal(normalizeMiniMaxH3Resolution("2k", "MiniMax-H3"), "2K");
    assert.equal(normalizeMiniMaxH3Resolution("2K", "MiniMax-H3-Max"), "768P");
    assert.equal(normalizeMiniMaxH3Resolution("480p", "MiniMax-H3-Max"), "480P");
    assert.equal(normalizeMiniMaxH3Ratio("adaptive", "text"), "16:9");
    assert.equal(normalizeMiniMaxH3Ratio("9:16", "frames"), "adaptive");
    assert.equal(normalizeMiniMaxH3Ratio("auto", "reference"), "adaptive");
});

test("model switching normalizes values only for the official channel", () => {
    const channel = { id: "minimax", name: "MiniMax", protocol: "minimax" as const, baseUrl: "https://api.minimax.io", apiKey: "test", models: miniMaxModels };
    const config = { ...defaultConfig, model: "MiniMax-H3-Max", videoModel: "MiniMax-H3-Max", videoChannelId: channel.id, localChannels: [channel], vquality: "2K", videoSeconds: "4", size: "adaptive" };
    const normalized = normalizeMiniMaxVideoConfig(config, "text");
    assert.equal(normalized.vquality, "768P");
    assert.equal(normalized.videoSeconds, "5");
    assert.equal(normalized.size, "16:9");
    const compatible = { ...config, localChannels: [{ ...channel, protocol: "openai" as const }] };
    assert.equal(normalizeMiniMaxVideoConfig(compatible), compatible);
});

test("reference modes and known media limits are validated without dropping inputs", () => {
    assert.equal(miniMaxVideoInputError("MiniMax-H3", "场景", { ...empty, audioReferences: [audio] }), "");
    assert.equal(miniMaxVideoInputError("MiniMax-H3-Max", "场景", { ...empty, firstFrame: image, lastFrame: image }), "");
    const invalid: Partial<MiniMaxVideoReferences>[] = [
        { lastFrame: image },
        { firstFrame: image, references: [image] },
        { references: Array(10).fill(image) },
        { videoReferences: Array(4).fill(video) },
        { audioReferences: Array(4).fill(audio) },
        { references: [{ ...image, bytes: 30 * 1024 * 1024 + 1 }] },
        { references: [{ ...image, width: 200 }] },
        { references: [{ ...image, width: 5761 }] },
        { references: [{ ...image, width: 256, height: 768 }] },
        { references: [{ ...image, type: "image/gif" }] },
        { videoReferences: [{ ...video, durationMs: 1000 }] },
        { videoReferences: [{ ...video, durationMs: 15001 }] },
        { videoReferences: [{ ...video, durationMs: 10000 }, video, video] },
        { audioReferences: [{ ...audio, bytes: 15 * 1024 * 1024 + 1 }] },
        { audioReferences: [{ ...audio, durationMs: 10000 }, audio, audio] },
    ];
    for (const input of invalid) assert.ok(miniMaxVideoInputError("MiniMax-H3", "场景", { ...empty, ...input }), JSON.stringify(input));
    for (const input of [{ references: [image] }, { videoReferences: [video] }, { audioReferences: [audio] }]) {
        assert.match(miniMaxVideoInputError("MiniMax-H3-Max", "场景", { ...empty, ...input }), /移除/);
    }
    assert.ok(miniMaxVideoInputError("MiniMax-H3", " ", empty));
    assert.ok(miniMaxVideoInputError("MiniMax-H3", "字".repeat(7001), empty));
    assert.equal(miniMaxVideoInputError("MiniMax-H3", "字".repeat(7000), empty), "");
});

test("canvas panels and generation share node overrides, global defaults and model normalization", () => {
    const channel = { id: "minimax", name: "MiniMax", protocol: "minimax" as const, baseUrl: "https://api.minimax.io", apiKey: "test", models: miniMaxModels };
    const global = { ...defaultConfig, videoModel: "MiniMax-H3", videoChannelId: channel.id, localChannels: [channel], canvasImageCount: "3", videoSeconds: "10", vquality: "2K", videoSize: "adaptive", audioVoice: "nova" };
    const node: CanvasNodeData = { id: "node", title: "video", type: CanvasNodeType.Video, position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { model: "MiniMax-H3-Max", channelId: channel.id, seconds: "4", size: "9:16" } };
    const config = buildGenerationConfig(global, node, "video");
    assert.equal(config.model, "MiniMax-H3-Max");
    assert.equal(config.videoChannelId, channel.id);
    assert.equal(config.videoSeconds, "5");
    assert.equal(config.vquality, "768P");
    assert.equal(config.size, "9:16");
    assert.equal(buildGenerationConfig(global, undefined, "video").videoSeconds, "10");
    assert.equal(normalizeVideoConfig(config, "frames").size, "adaptive");
    assert.equal(buildGenerationConfig(global, { ...node, type: CanvasNodeType.Panorama }, "image").size, PANORAMA_IMAGE_SIZE);
    assert.equal(buildGenerationConfig(global, undefined, "image").count, "3");
    const audio = buildGenerationConfig(global, { ...node, type: CanvasNodeType.Audio, metadata: { audioFormat: "wav" } }, "audio");
    assert.equal(audio.audioVoice, "nova");
    assert.equal(audio.audioFormat, "wav");
    assert.deepEqual(videoConfigPatch("videoSeconds", "8"), { seconds: "8" });
    assert.deepEqual(videoConfigPatch("videoGenerateAudio", "true"), { generateAudio: "true" });
});
